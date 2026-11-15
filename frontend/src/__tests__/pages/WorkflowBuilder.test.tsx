import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { WorkflowWizard } from '../../pages/WorkflowWizard';
import { run, template, workflow } from '../fixtures/workflows';

const svc = vi.hoisted(() => ({
  getWorkflow: vi.fn(), createWorkflow: vi.fn(), updateWorkflow: vi.fn(), testRun: vi.fn(), getRegions: vi.fn(), previewCatchUp: vi.fn(),
  runCatchUp: vi.fn(), regenerateToken: vi.fn(), getRuns: vi.fn(), retryRun: vi.fn(),
}));
vi.mock('../../services/workflows.service', () => ({ workflowsService: svc }));

let allowed: string[] = [];
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => r === 'workflows' && allowed.includes(a), isManager: true }),
}));
vi.mock('../../pages/orders/useFilterOptions', () => ({
  useFilterOptions: () => ({
    products: [],
    reps: [{ id: 3, name: 'Abena Owusu' }],
    agents: [{ id: 7, name: 'Kofi Appiah' }, { id: 8, name: 'Esi Badu' }],
  }),
}));

const apiError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status, data } });

const renderAt = (path: string, state?: unknown) => render(
  <ToastProvider>
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/workflows" element={<div>LIST PAGE</div>} />
        <Route path="/workflows/new" element={<WorkflowWizard />} />
        <Route path="/workflows/:id" element={<WorkflowWizard />} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>,
);

const openStep = (name: RegExp) => userEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  allowed = ['view', 'create', 'update', 'delete', 'execute'];
  svc.getRegions.mockResolvedValue({ country: 'Ghana', countryCode: 'GH', regions: ['Greater Accra', 'Ashanti'] });
  svc.getRuns.mockResolvedValue({ executions: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } });
  svc.getWorkflow.mockImplementation(async (id) => workflow({ id }));
  svc.previewCatchUp.mockResolvedValue({ count: 38, orderIds: [1, 2], capped: false });
  svc.createWorkflow.mockImplementation(async (body) => ({ workflow: workflow({ id: 55, ...body }) }));
  svc.updateWorkflow.mockImplementation(async (id, body) => ({ workflow: workflow({ id, ...body }) }));
});

describe('Workflow builder, five steps (M9-T42)', () => {
  it('has the five steps of the mockup', () => {
    renderAt('/workflows/new');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['1Basic info', '2Trigger', '3Conditions', '4Actions', '5Review']);
  });

  it('saves a workflow from all five steps with the body the API wants', async () => {
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'Ashanti orders');
    await openStep(/Trigger/);
    await userEvent.click(screen.getByRole('button', { name: /Status change/ }));
    await userEvent.selectOptions(screen.getByLabelText('When the order moves to'), 'confirmed');
    await openStep(/Conditions/);
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Field of condition 1'), 'region');
    await userEvent.selectOptions(await screen.findByLabelText('Value'), 'Ashanti');
    await openStep(/Actions/);
    await userEvent.click(screen.getByRole('button', { name: 'Assign to' }));
    await userEvent.selectOptions(screen.getByLabelText('Add a person'), '7');
    await userEvent.selectOptions(screen.getByLabelText('Add a person'), '8');
    await userEvent.click(screen.getByRole('button', { name: 'Weighted %' }));
    await userEvent.clear(screen.getByLabelText('Weight of Kofi Appiah'));
    await userEvent.type(screen.getByLabelText('Weight of Kofi Appiah'), '70');
    await userEvent.clear(screen.getByLabelText('Weight of Esi Badu'));
    await userEvent.type(screen.getByLabelText('Weight of Esi Badu'), '30');
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));

    await waitFor(() => expect(svc.createWorkflow).toHaveBeenCalledTimes(1));
    expect(svc.createWorkflow).toHaveBeenCalledWith({
      name: 'Ashanti orders',
      description: undefined,
      triggerType: 'status_change',
      triggerData: { status: 'confirmed' },
      conditions: { logic: 'AND', rules: [{ field: 'region', operator: 'is', value: 'Ashanti' }] },
      actions: [{ type: 'assign_to', config: { role: 'delivery_agent', userIds: [7, 8], split: 'weighted', weights: { 7: 70, 8: 30 } } }],
      isActive: true,
    });
    expect(await screen.findByText('Workflow saved')).toBeInTheDocument();
  });

  it('"Region is X" lists the regions of the store country', async () => {
    renderAt('/workflows/new');
    await openStep(/Conditions/);
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Field of condition 1'), 'region');
    const value = await screen.findByLabelText('Value');
    await waitFor(() => expect(within(value).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pick one', 'Greater Accra', 'Ashanti']));
    expect(svc.getRegions).toHaveBeenCalled();
  });

  it('offers only the actions the API accepts: no assign_agent and no add_tag', async () => {
    renderAt('/workflows/new');
    await openStep(/Actions/);
    const names = screen.getAllByRole('button').filter((b) => b.closest('.addact')).map((b) => b.textContent);
    expect(names).toEqual(['Assign to', 'Send SMS', 'Send WhatsApp', 'Send email', 'Send auto-confirm', 'Change order', 'Wait', 'HTTP request']);
    expect(screen.queryByText(/assign agent|tag/i)).not.toBeInTheDocument();
  });

  it('the auto-confirm action saves the chosen channel', async () => {
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'Confirm new orders');
    await openStep(/Actions/);
    await userEvent.click(screen.getByRole('button', { name: 'Send auto-confirm' }));
    expect(screen.getByText(/Sends the confirm request with Confirm, Change and Cancel buttons/)).toBeInTheDocument();
    expect(screen.getByLabelText('Channel')).toHaveValue('whatsapp');
    await userEvent.selectOptions(screen.getByLabelText('Channel'), 'sms');
    expect(screen.getByText('Channel: SMS')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));
    await waitFor(() => expect(svc.createWorkflow).toHaveBeenCalled());
    expect(svc.createWorkflow.mock.calls[0][0].actions).toEqual([{ type: 'send_auto_confirm', config: { channel: 'sms' } }]);
  });

  it('a schedule is saved as a cron and has no conditions', async () => {
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'Morning reminder');
    await openStep(/Trigger/);
    await userEvent.click(screen.getByRole('button', { name: /Schedule/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Every week' }));
    await userEvent.selectOptions(screen.getByLabelText('On'), '1');
    await openStep(/Conditions/);
    expect(screen.getByText(/A schedule runs with no order, so it has no conditions/)).toBeInTheDocument();
    await openStep(/Actions/);
    await userEvent.click(screen.getByRole('button', { name: 'Send SMS' }));
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));
    await waitFor(() => expect(svc.createWorkflow).toHaveBeenCalled());
    const body = svc.createWorkflow.mock.calls[0][0];
    expect(body.triggerType).toBe('time_based');
    expect(body.triggerData).toEqual({ cron: '0 9 * * 1' });
    expect(body.conditions).toEqual({});
  });

  it('a webhook workflow shows its address once, after it is saved', async () => {
    svc.createWorkflow.mockImplementation(async (body) => ({ workflow: workflow({ id: 56, ...body, hasWebhookToken: true }), webhookToken: 'tok_abc' }));
    svc.getWorkflow.mockResolvedValue(workflow({ id: 56, triggerType: 'webhook', triggerData: {}, hasWebhookToken: true }));
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'From the store');
    await openStep(/Trigger/);
    await userEvent.click(screen.getByRole('button', { name: /Webhook/ }));
    expect(screen.getByText('The address appears when the workflow is saved.')).toBeInTheDocument();
    await openStep(/Actions/);
    await userEvent.click(screen.getByRole('button', { name: 'Send SMS' }));
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));
    await waitFor(() => expect(svc.createWorkflow).toHaveBeenCalled());
    await openStep(/Trigger/);
    expect(await screen.findByLabelText('Webhook address')).toHaveTextContent(/\/api\/workflows\/hooks\/tok_abc$/);
    expect(screen.getByRole('button', { name: /Regenerate token/ })).toBeInTheDocument();
  });

  it('regenerate makes a new address for a saved webhook workflow', async () => {
    svc.getWorkflow.mockResolvedValue(workflow({ id: 9, triggerType: 'webhook', triggerData: {}, hasWebhookToken: true }));
    svc.regenerateToken.mockResolvedValue('tok_new');
    renderAt('/workflows/9');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Trigger/);
    expect(screen.getByText(/It is not shown again/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Regenerate token/ }));
    expect(svc.regenerateToken).toHaveBeenCalledWith(9);
    expect(await screen.findByLabelText('Webhook address')).toHaveTextContent('tok_new');
  });

  it('starts from a template: its values fill the form', async () => {
    renderAt('/workflows/new', { template: template() });
    expect(screen.getByLabelText('Name')).toHaveValue('Confirmation text');
    await openStep(/Actions/);
    expect(screen.getByText('To +233200000000')).toBeInTheDocument();
  });
});

describe('Workflow builder validation (M9-T42)', () => {
  it('shows the API message next to the condition it names', async () => {
    svc.createWorkflow.mockRejectedValue(apiError(400, { errors: ['Condition 1: enter a value for "totalAmount"', 'Action 1: "send_sms" is no longer available, use something else'] }));
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'Big orders');
    await openStep(/Conditions/);
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await openStep(/Actions/);
    await userEvent.click(screen.getByRole('button', { name: 'Send SMS' }));
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));

    // the builder opens the step with the first problem, and the message sits under the row
    const group = await screen.findByRole('group', { name: 'Condition 1' });
    expect(group.parentElement).toHaveTextContent('enter a value for "totalAmount"');
    expect(screen.getByRole('tab', { name: /Conditions/ })).toHaveTextContent('!');
    // the action message sits in its card
    await openStep(/Actions/);
    expect(screen.getByRole('alert')).toHaveTextContent('"send_sms" is no longer available');
  });

  it('shows a refusal that names no field on the Review step', async () => {
    svc.createWorkflow.mockRejectedValue(apiError(400, { error: 'Workflow must have at least one action' }));
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'Empty');
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));
    await openStep(/Review/);
    expect(await screen.findByText('Workflow must have at least one action')).toBeInTheDocument();
  });

  it('asks for a name before it calls the API', async () => {
    renderAt('/workflows/new');
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));
    expect(await screen.findByText('Give the workflow a name.')).toBeInTheDocument();
    expect(svc.createWorkflow).not.toHaveBeenCalled();
  });
});

describe('Workflow builder test run (M9-T42)', () => {
  it('saves a new workflow as an inactive draft, then shows the plan and says nothing was sent', async () => {
    svc.testRun.mockResolvedValue({
      executionId: 9, mode: 'test', sent: false,
      conditions: { evaluated: true, matches: true, reason: null },
      plan: [{ index: 0, type: 'send_sms', willDo: 'Send an SMS to +233201234567: "Hi"' }, { index: 1, type: 'wait', willDo: 'Wait 3600 seconds' }],
    });
    renderAt('/workflows/new');
    await userEvent.type(screen.getByLabelText('Name'), 'Try me');
    await openStep(/Actions/);
    await userEvent.click(screen.getByRole('button', { name: 'Send SMS' }));
    await openStep(/Review/);
    await userEvent.type(screen.getByLabelText('Order number for the test'), '#24117');
    await userEvent.click(screen.getByRole('button', { name: 'Run test' }));

    await waitFor(() => expect(svc.testRun).toHaveBeenCalledWith(55, 24117));
    expect(svc.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    expect(await screen.findByText('Nothing was sent.')).toBeInTheDocument();
    expect(screen.getByText('1. Send an SMS to +233201234567: "Hi"')).toBeInTheDocument();
    expect(screen.getByText('2. Wait 3600 seconds')).toBeInTheDocument();
  });

  it('says so when the conditions do not match the order', async () => {
    svc.getWorkflow.mockResolvedValue(workflow({ id: 4 }));
    svc.testRun.mockResolvedValue({ executionId: 9, mode: 'test', sent: false, conditions: { evaluated: true, matches: false, reason: 'conditions_not_met' }, plan: [] });
    renderAt('/workflows/4');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Review/);
    await userEvent.click(screen.getByRole('button', { name: 'Run test' }));
    expect(await screen.findByText(/The conditions do not match this order, so no action would run/)).toBeInTheDocument();
    expect(svc.createWorkflow).not.toHaveBeenCalled();
    expect(svc.testRun).toHaveBeenCalledWith(4, undefined);
  });

  it('a saved workflow with unsaved changes asks to save before the test', async () => {
    svc.getWorkflow.mockResolvedValue(workflow({ id: 4 }));
    renderAt('/workflows/4');
    await userEvent.type(await screen.findByDisplayValue('Send confirmation SMS'), ' v2');
    await openStep(/Review/);
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled();
    expect(screen.getByText(/Save your changes first/)).toBeInTheDocument();
  });
});

describe('Workflow builder catch-up (M9-T42, F-512)', () => {
  const assignFlow = workflow({ id: 6, actions: [{ type: 'assign_to', config: { role: 'delivery_agent', userIds: [7], split: 'even' } }] });

  it('shows "N would be assigned now" from the preview API', async () => {
    svc.getWorkflow.mockResolvedValue(assignFlow);
    renderAt('/workflows/6');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Actions/);
    expect(await screen.findByText(/38 orders would be assigned now/)).toBeInTheDocument();
    expect(svc.previewCatchUp).toHaveBeenCalledWith(6);
  });

  it('saving with the switch on starts the catch-up', async () => {
    svc.getWorkflow.mockResolvedValue(assignFlow);
    svc.runCatchUp.mockResolvedValue({ queued: 38, batches: 1 });
    renderAt('/workflows/6');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Actions/);
    await screen.findByText(/38 orders would be assigned now/);
    await userEvent.click(screen.getByRole('switch', { name: 'Also assign orders that have no one yet' }));
    await userEvent.click(screen.getByRole('button', { name: /Save workflow/ }));
    await waitFor(() => expect(svc.runCatchUp).toHaveBeenCalledWith(6));
    expect(await screen.findByText('Catch-up started on 38 orders')).toBeInTheDocument();
  });

  it('the switch is not drawn for a user who is not a manager or for a schedule', async () => {
    svc.getWorkflow.mockResolvedValue(workflow({ id: 6, triggerType: 'time_based', triggerData: { cron: '0 9 * * *' }, actions: assignFlow.actions }));
    renderAt('/workflows/6');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Actions/);
    expect(screen.queryByRole('switch', { name: /no one yet/ })).not.toBeInTheDocument();
    expect(svc.previewCatchUp).not.toHaveBeenCalled();
  });
});

describe('Workflow builder run history (M9-T43)', () => {
  it('shows runs with status, source and order link, and opens the steps of one', async () => {
    svc.getWorkflow.mockResolvedValue(workflow({ id: 4 }));
    svc.getRuns.mockResolvedValue({
      executions: [
        run({ id: 1 }),
        run({ id: 2, status: 'failed', error: 'SMS is not set up: message not sent', failedStepIndex: 0, steps: [{ index: 0, type: 'send_sms', status: 'failed', result: null, error: 'SMS is not set up: message not sent' }] }),
      ],
      pagination: { page: 1, limit: 10, total: 2, pages: 1 },
    });
    renderAt('/workflows/4');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Review/);
    const table = await screen.findByRole('table', { name: 'Run history' });
    expect(within(table).getAllByRole('link', { name: '#24117' })[0]).toHaveAttribute('href', '/orders/24117');
    expect(within(table).getByText('Success')).toBeInTheDocument();
    expect(within(table).getByText('Failed')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'Show steps of run 2' }));
    expect(within(table).getAllByText('SMS is not set up: message not sent').length).toBeGreaterThan(1);
  });

  it('Retry shows only on a failed run, and a 409 is shown as the API wrote it', async () => {
    svc.getWorkflow.mockResolvedValue(workflow({ id: 4 }));
    svc.getRuns.mockResolvedValue({
      executions: [run({ id: 1 }), run({ id: 2, status: 'failed', failedStepIndex: 0, error: 'boom' }), run({ id: 3, status: 'skipped', error: 'conditions_not_met' })],
      pagination: { page: 1, limit: 10, total: 3, pages: 1 },
    });
    svc.retryRun.mockRejectedValue(apiError(409, { error: 'The workflow changed since this run. Run it again instead.' }));
    renderAt('/workflows/4');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Review/);
    await screen.findByRole('table', { name: 'Run history' });
    expect(screen.getAllByRole('button', { name: /^Retry run/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Retry run 2' }));
    expect(svc.retryRun).toHaveBeenCalledWith(2);
    expect(await screen.findByText('The workflow changed since this run. Run it again instead.')).toBeInTheDocument();
  });

  it('a user who may not execute sees no Retry', async () => {
    allowed = ['view', 'update'];
    svc.getWorkflow.mockResolvedValue(workflow({ id: 4 }));
    svc.getRuns.mockResolvedValue({ executions: [run({ id: 2, status: 'failed', error: 'boom' })], pagination: { page: 1, limit: 10, total: 1, pages: 1 } });
    renderAt('/workflows/4');
    await screen.findByDisplayValue('Send confirmation SMS');
    await openStep(/Review/);
    await screen.findByRole('table', { name: 'Run history' });
    expect(screen.queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument();
  });
});

describe('Workflow builder without permission', () => {
  it('a viewer sees no Save button and no Regenerate', async () => {
    allowed = ['view'];
    svc.getWorkflow.mockResolvedValue(workflow({ id: 4, triggerType: 'webhook', triggerData: {}, hasWebhookToken: true }));
    renderAt('/workflows/4');
    await screen.findByDisplayValue('Send confirmation SMS');
    expect(screen.queryByRole('button', { name: /Save workflow/ })).not.toBeInTheDocument();
    await openStep(/Trigger/);
    expect(screen.queryByRole('button', { name: /Regenerate token/ })).not.toBeInTheDocument();
  });
});
