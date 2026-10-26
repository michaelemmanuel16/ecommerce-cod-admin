import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { CollectionActionModal } from '../../components/financial/modals/CollectionActionModal';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { PartnerDeposit } from '../../services/collections.service';

const svc = vi.hoisted(() => ({ verifyDeposit: vi.fn(), rejectDeposit: vi.fn() }));
vi.mock('../../services/collections.service', () => ({ collectionsService: svc }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, user: { role: 'accountant' } }) }));

const dep = (over: Partial<PartnerDeposit> = {}): PartnerDeposit => ({
  id: 5, agentId: 7, agent: { id: 7, firstName: 'Esi', lastName: 'Badu', email: null }, amount: 1344, status: 'pending', depositDate: '2026-10-21T10:00:00Z',
  depositMethod: 'momo', referenceNumber: 'MM-77', receiptUrl: null, rejectReason: null, allocations: null, ...over,
});
const onChanged = vi.fn();
const onClose = vi.fn();
const open = (deposit = dep(), cashHeld: number | null = 2100) =>
  render(<ToastProvider><CollectionActionModal deposit={deposit} cashHeld={cashHeld} onClose={onClose} onChanged={onChanged} /></ToastProvider>);
const refuse = (message: string) => Object.assign(new axios.AxiosError('refused'), { response: { status: 409, data: { error: message } } });

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  onChanged.mockReset();
  onClose.mockReset();
  useConfigStore.setState({ currency: 'GHS' });
  svc.verifyDeposit.mockResolvedValue(undefined);
  svc.rejectDeposit.mockResolvedValue(undefined);
});

describe('Review collection modal (M5-T36, F-912)', () => {
  it('shows the receipt and the facts side by side, and says when there is no receipt', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Esi Badu \u00b7 21 Oct \u00b7 GH\u20b51,344')).toBeInTheDocument();
    expect(within(dialog).getByText('No receipt attached')).toBeInTheDocument();
    expect(within(dialog).getByText('Amount paid')).toBeInTheDocument();
    expect(within(dialog).getByText('Orders covered')).toBeInTheDocument();
    expect(within(dialog).getByText('GH\u20b52,100')).toBeInTheDocument();
  });

  it('shows a receipt image', () => {
    open(dep({ receiptUrl: 'https://files.example/r.png' }));
    expect(screen.getByRole('img', { name: 'Receipt' })).toHaveAttribute('src', 'https://files.example/r.png');
  });

  it('Verify and reconcile does it in one step, reloads the page figures and closes; no approve button', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: /Verify and reconcile/ }));
    await waitFor(() => expect(svc.verifyDeposit).toHaveBeenCalledWith(5));
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('shows the server sentence when a verify is refused', async () => {
    svc.verifyDeposit.mockRejectedValue(refuse('Already verified'));
    open();
    await userEvent.click(screen.getByRole('button', { name: /Verify and reconcile/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already verified');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Reject asks for a reason from the list and a note, then sends them together', async () => {
    open();
    expect(screen.queryByLabelText('Rejection reason')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const why = screen.getByLabelText('Rejection reason');
    expect(within(why).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Amount does not match the order list', 'Receipt is unclear or edited', 'No receipt attached', 'Payment not found in MoMo or bank', 'Other',
    ]);
    await userEvent.selectOptions(why, 'Receipt is unclear or edited');
    await userEvent.type(screen.getByLabelText(/Note to the partner/), 'Send a sharper photo');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    await waitFor(() => expect(svc.rejectDeposit).toHaveBeenCalledWith(5, 'Receipt is unclear or edited: Send a sharper photo'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('a pay-in that is already decided opens read-only', () => {
    open(dep({ status: 'rejected', rejectReason: 'No receipt attached' }));
    expect(screen.queryByRole('button', { name: /Verify and reconcile/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('No receipt attached', { selector: 'em' })).toBeInTheDocument();
  });
});
