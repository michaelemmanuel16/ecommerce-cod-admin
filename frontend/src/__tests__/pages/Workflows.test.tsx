import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Workflows } from '../../pages/Workflows';
import { template, workflow } from '../fixtures/workflows';

const svc = vi.hoisted(() => ({
  getWorkflows: vi.fn(), getTemplates: vi.fn(), updateWorkflow: vi.fn(), deleteWorkflow: vi.fn(), runOnOrders: vi.fn(),
}));
vi.mock('../../services/workflows.service', () => ({ workflowsService: svc }));

let allowed: string[] = [];
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => r === 'workflows' && allowed.includes(a) }),
}));

const summary = { activeCount: 1, runsToday: 7, failuresToday: 2 };

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{(l.state as any)?.template ? ` template:${(l.state as any).template.id}` : ''}</div>;
}

const renderPage = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/workflows']}>
      <Routes>
        <Route path="/workflows" element={<Workflows />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>,
);

beforeEach(() => {
  vi.clearAllMocks();
  allowed = ['view', 'create', 'update', 'delete', 'execute'];
  svc.getWorkflows.mockResolvedValue({
    workflows: [workflow(), workflow({ id: 2, name: 'Daily reminder', description: null, isActive: false, triggerType: 'time_based', triggerData: { cron: '0 9 * * *' }, stats: { runs: 0, succeeded: 0, failed: 0, days: 30, lastRunAt: null } })],
    summary,
  });
  svc.getTemplates.mockResolvedValue([template(), template({ id: 'wa', name: 'WhatsApp confirmation', available: false, unavailableReason: 'Needs WhatsApp in Connections' })]);
  svc.updateWorkflow.mockResolvedValue({ workflow: workflow() });
  svc.deleteWorkflow.mockResolvedValue(undefined);
  svc.runOnOrders.mockResolvedValue({ queued: 1, batches: 1 });
});

describe('Workflows list (M9-T41)', () => {
  it('reads { workflows, summary }: tiles, rows with 30-day runs, last run and trigger', async () => {
    renderPage();
    const row = (await screen.findByRole('link', { name: 'Send confirmation SMS' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('Status changes to Confirmed')).toBeInTheDocument();
    expect(within(row).getByText('12')).toBeInTheDocument();
    expect(within(row).getByText('10 passed, 2 failed')).toBeInTheDocument();
    expect(within(row).getByText(/ago/)).toBeInTheDocument();
    const idle = screen.getByRole('link', { name: 'Daily reminder' }).closest('tr') as HTMLElement;
    expect(within(idle).getByText('Every day at 09:00')).toBeInTheDocument();
    expect(within(idle).getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Runs today').closest('.kpi')).toHaveTextContent('7');
    expect(screen.getByText('Failed runs today').closest('.kpi')).toHaveTextContent('2');
    expect(screen.getByText('Active', { selector: '.kpi .l' }).closest('.kpi')).toHaveTextContent('1');
  });

  it('filters by tab and by search', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Daily reminder' });
    await userEvent.click(screen.getByRole('tab', { name: /^Inactive/ }));
    expect(screen.queryByRole('link', { name: 'Send confirmation SMS' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^All/ }));
    await userEvent.type(screen.getByLabelText('Search workflows'), 'zzz');
    expect(screen.getByText('No workflows match.')).toBeInTheDocument();
  });

  it('shows an empty state when there are no workflows', async () => {
    svc.getWorkflows.mockResolvedValue({ workflows: [], summary: { activeCount: 0, runsToday: 0, failuresToday: 0 } });
    renderPage();
    expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
  });

  it('the switch calls the update endpoint and reloads the list', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('switch', { name: 'Active: Daily reminder' }));
    expect(svc.updateWorkflow).toHaveBeenCalledWith(2, { isActive: true });
    await waitFor(() => expect(svc.getWorkflows).toHaveBeenCalledTimes(2));
  });

  it('delete asks first, then calls the API', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Daily reminder' }));
    expect(svc.deleteWorkflow).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete "Daily reminder"?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(svc.deleteWorkflow).toHaveBeenCalledWith(2);
  });

  it('Cancel in the delete dialog deletes nothing', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Daily reminder' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(svc.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('shows the API message when the switch is refused', async () => {
    svc.updateWorkflow.mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { data: { error: 'Only the owner, an admin or a manager can do this' } } }));
    renderPage();
    await userEvent.click(await screen.findByRole('switch', { name: 'Active: Daily reminder' }));
    expect(await screen.findByText('Only the owner, an admin or a manager can do this')).toBeInTheDocument();
  });
});

describe('Workflows gallery (M9-T41)', () => {
  it('lists the templates the API sends and nothing else', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Confirmation text/ })).toBeEnabled();
    expect(screen.getByText('2 templates')).toBeInTheDocument();
    expect(screen.queryByText(/Shopify/i)).not.toBeInTheDocument();
  });

  it('a template that is not available shows its message and cannot be picked', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /WhatsApp confirmation/ });
    expect(card).toBeDisabled();
    expect(within(card).getByText('Needs WhatsApp in Connections')).toBeInTheDocument();
    await userEvent.click(card);
    expect(screen.queryByTestId('where')).not.toBeInTheDocument();
  });

  it('an available template opens the builder with the template', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Confirmation text/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/workflows/new template:send-confirmation-sms');
  });
});

describe('Workflows run button (M9-T43)', () => {
  it('Run opens the dialog for that workflow and starts it on the typed orders', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Run Send confirmation SMS' }));
    await userEvent.type(screen.getByLabelText('Order numbers'), '#24117, 24118');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(svc.runOnOrders).toHaveBeenCalledWith(1, [24117, 24118], false);
  });

  it('there is no Run button on a workflow that is off', async () => {
    renderPage();
    await screen.findByRole('link', { name: 'Daily reminder' });
    expect(screen.queryByRole('button', { name: 'Run Daily reminder' })).not.toBeInTheDocument();
  });
});

describe('Workflows without permission', () => {
  it('a viewer sees no write controls', async () => {
    allowed = ['view'];
    renderPage();
    await screen.findByRole('link', { name: 'Send confirmation SMS' });
    expect(screen.queryByRole('button', { name: /New workflow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Browse templates/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Run / })).not.toBeInTheDocument();
    expect(screen.queryByText('Start from a template')).not.toBeInTheDocument();
    expect(svc.getTemplates).not.toHaveBeenCalled();
  });
});

