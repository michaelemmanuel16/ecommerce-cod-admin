import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AgentCollections } from '../../pages/financial/AgentCollections';
import { ToastProvider } from '../../components/ui-v2';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useConfigStore } from '../../stores/configStore';
import { CARD, REPORT } from '../fixtures/collections';

const svc = vi.hoisted(() => ({
  aging: vi.fn(), unpaidByAge: vi.fn(), deposits: vi.fn(), verifyDeposit: vi.fn(), rejectDeposit: vi.fn(), remind: vi.fn(), block: vi.fn(), unblock: vi.fn(),
}));
vi.mock('../../services/collections.service', async (orig) => ({ ...(await orig<typeof import('../../services/collections.service')>()), collectionsService: svc }));
let role = 'super_admin';
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => role === 'super_admin' || (r === 'financial' && a === 'view'), isAdmin: role === 'super_admin', user: { role } }),
}));

const open = () => render(<MemoryRouter><ToastProvider><AgentCollections /></ToastProvider></MemoryRouter>);
const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

beforeEach(() => {
  clearBlockCache();
  Object.values(svc).forEach((m) => m.mockReset());
  role = 'super_admin';
  useConfigStore.setState({ currency: 'GHS' });
  svc.aging.mockResolvedValue(REPORT);
  svc.unpaidByAge.mockResolvedValue(CARD);
  svc.deposits.mockResolvedValue([]);
  svc.verifyDeposit.mockResolvedValue(undefined);
});

const dep = (id: number, over: Record<string, unknown> = {}) => ({
  id, agentId: 7, agent: { id: 7, firstName: 'Kofi', lastName: 'Appiah', email: null }, amount: 300, status: 'pending', depositDate: '2026-10-21T10:00:00Z',
  depositMethod: 'momo', referenceNumber: `MM-${id}`, receiptUrl: 'https://files.example/r.png', rejectReason: null, allocations: null, ...over,
});

describe('Agent collections tab (M5-T36)', () => {
  it('shows the four buckets, cash held, oldest unpaid and days to pay per partner, and never a fixed "7 days"', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Agent aging' });
    for (const h of ['0–3 days', '4–7 days', '8–14 days', '15+ days', 'Cash held', 'Oldest', 'Days to pay', 'Status', 'Actions']) {
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    const kofi = row('Kofi Appiah');
    expect(kofi).toHaveTextContent('GH₵672');
    expect(kofi).toHaveTextContent('18 days');
    expect(kofi).toHaveTextContent('2 days');
    expect(within(kofi).getByRole('button', { name: 'Send reminder to Kofi Appiah' })).toHaveClass('pri'); // overdue: the reminder is the main action
    expect(kofi).not.toHaveTextContent('7 days'); // Kofi's days to pay is 2: the figure is the partner's own
    expect(row('Esi Badu')).toHaveTextContent('7 days');
  });

  it('shows the four mockup tiles, the exposure chart card and an All partners total row', async () => {
    svc.deposits.mockResolvedValue([dep(1), dep(2, { amount: 200 })]);
    open();
    await screen.findByRole('table', { name: 'Agent aging' });
    for (const label of ['Cash with agents and 3PLs', 'Overdue, 8 days or more', 'Collections to verify', 'Blocked from deliveries']) {
      expect(screen.getByText(label, { selector: '.l' })).toBeInTheDocument();
    }
    expect(screen.getByText('GH₵772', { selector: '.v' })).toBeInTheDocument(); // cash with partners
    expect(screen.getByText('GH₵348', { selector: '.v' })).toBeInTheDocument(); // 8 days and older: 200 + 148
    await waitFor(() => expect(screen.getByText('GH₵500')).toBeInTheDocument()); // two pay-ins to verify, 300 + 200
    expect(screen.getByText('Cash exposure by partner')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'All partners' })).toBeInTheDocument();
    // the total row names the oldest unpaid order across the partners (M5 UI fix V9)
    expect(screen.getByRole('row', { name: /All partners/ })).toHaveTextContent('18 days');
    expect(screen.queryByRole('link', { name: /Findings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check cash held' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Review Kofi Appiah$/ })).not.toBeInTheDocument(); // Review is on the pay-ins, not the aging row
  });

  it('lists the pending pay-ins with a receipt tag, reconciles the selected ones one by one', async () => {
    svc.deposits.mockResolvedValue([dep(1), dep(2, { receiptUrl: null }), dep(3, { status: 'verified', allocations: [{ collectionId: 4, amount: '300' }] })]);
    open();
    const table = await screen.findByRole('table', { name: 'Collections to verify' });
    expect(within(table).getByText('No receipt')).toBeInTheDocument();
    expect(within(table).getAllByText('PNG')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Reconcile selected/ })).toBeDisabled();
    await userEvent.click(within(table).getByLabelText('Select all pending'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Reconcile selected/ }));
    await waitFor(() => expect(svc.verifyDeposit).toHaveBeenCalledTimes(2));
    expect(svc.verifyDeposit).toHaveBeenNthCalledWith(1, 1);
    expect(svc.verifyDeposit).toHaveBeenNthCalledWith(2, 2);
    expect(await screen.findByText('2 collections reconciled')).toBeInTheDocument();
  });

  it('Review opens the collection with its receipt and facts', async () => {
    svc.deposits.mockResolvedValue([dep(1)]);
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Review Kofi Appiah 21 Oct' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Review collection from Kofi Appiah')).toBeInTheDocument();
    expect(within(dialog).getByText('Cash the partner holds')).toBeInTheDocument();
    expect(within(dialog).getByText('GH₵672')).toBeInTheDocument(); // Kofi's cash held, from the aging report
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
    expect(await screen.findByText('No partner holds unpaid orders')).toBeInTheDocument();
    expect(screen.getByText('No partner holds cash')).toBeInTheDocument();
  });

  it('shows the error state and retries', async () => {
    svc.aging.mockRejectedValueOnce(new Error('x'));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Agent aging' })).toBeInTheDocument();
  });
});
