import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AgentCollections } from '../../pages/financial/AgentCollections';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import { CARD, REPORT } from '../fixtures/collections';

const svc = vi.hoisted(() => ({
  aging: vi.fn(), unpaidByAge: vi.fn(), toVerify: vi.fn(), deposits: vi.fn(), remind: vi.fn(), block: vi.fn(), unblock: vi.fn(), syncCashFindings: vi.fn(),
}));
vi.mock('../../services/collections.service', async (orig) => ({ ...(await orig<typeof import('../../services/collections.service')>()), collectionsService: svc }));
vi.mock('../../services/financial.service', () => ({ financialService: { downloadAgentAgingCSV: vi.fn() } }));
let role = 'super_admin';
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => role === 'super_admin' || (r === 'financial' && a === 'view'), isAdmin: role === 'super_admin', user: { role } }),
}));

const open = () => render(<MemoryRouter><ToastProvider><AgentCollections /></ToastProvider></MemoryRouter>);
const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  role = 'super_admin';
  useConfigStore.setState({ currency: 'GHS' });
  svc.aging.mockResolvedValue(REPORT);
  svc.unpaidByAge.mockResolvedValue(CARD);
  svc.toVerify.mockResolvedValue([]);
  svc.deposits.mockResolvedValue([]);
});

describe('Agent collections tab (M5-T36)', () => {
  it('shows the four buckets, cash held, oldest unpaid and days to pay per partner, and never a fixed "7 days"', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Agent aging' });
    for (const h of ['0–3 days', '4–7 days', '8–14 days', '15+ days', 'Cash held', 'Oldest unpaid', 'Days to pay']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    const kofi = row('Kofi Appiah');
    expect(kofi).toHaveTextContent('GH₵672');
    expect(kofi).toHaveTextContent('18 days');
    expect(kofi).toHaveTextContent('2 days');
    expect(kofi).toHaveTextContent('3 overdue');
    expect(kofi).not.toHaveTextContent('7 days'); // Kofi's days to pay is 2: the figure is the partner's own
    expect(row('Esi Badu')).toHaveTextContent('7 days');
  });

  it('has no approve button anywhere', async () => {
    open();
    await screen.findByRole('table', { name: 'Agent aging' });
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('Show overdue only hides partners within their days to pay', async () => {
    open();
    await screen.findByRole('table', { name: 'Agent aging' });
    await userEvent.click(screen.getByLabelText(/Show overdue only/));
    expect(screen.queryByRole('row', { name: /Esi Badu/ })).not.toBeInTheDocument();
    expect(row('Kofi Appiah')).toBeInTheDocument();
  });

  it('Send reminder calls the API for that partner and says so', async () => {
    svc.remind.mockResolvedValue({ sent: true, unpaidOrders: 4, overdueOrders: 3 });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Send reminder to Kofi Appiah' }));
    await waitFor(() => expect(svc.remind).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Reminder sent to Kofi Appiah on WhatsApp')).toBeInTheDocument();
  });

  it('Block needs a reason and says open deliveries stay; Unblock calls the API', async () => {
    svc.block.mockResolvedValue(undefined);
    svc.unblock.mockResolvedValue(undefined);
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Block Kofi Appiah' }));
    expect(screen.getByText(/Deliveries they already have stay with them/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: 'Block partner' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Two weeks late');
    await userEvent.click(go);
    await waitFor(() => expect(svc.block).toHaveBeenCalledWith(7, 'Two weeks late'));

    await userEvent.click(await screen.findByRole('button', { name: 'Unblock Esi Badu' }));
    await waitFor(() => expect(svc.unblock).toHaveBeenCalledWith(8));
  });

  it('disables Block with the reason for a role that cannot block, and does not call the API', async () => {
    role = 'accountant';
    open();
    const block = await screen.findByRole('button', { name: 'Block Kofi Appiah' });
    expect(block).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(block);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.hover(block);
    expect(within(block.closest('.tip') as HTMLElement).getByRole('tooltip', { hidden: true })).toHaveTextContent('Only the owner, admins and managers can block or unblock a partner.');
  });

  it('shows an empty state when no partner holds cash, and an error with Try again', async () => {
    svc.aging.mockResolvedValue({ ...REPORT, partners: [] });
    open();
    expect(await screen.findByText('No partner holds cash')).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    svc.aging.mockRejectedValueOnce(new Error('x'));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Agent aging' })).toBeInTheDocument();
  });
});
