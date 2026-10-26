import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { CollectionActionModal } from '../../components/financial/modals/CollectionActionModal';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';

const svc = vi.hoisted(() => ({ toVerify: vi.fn(), deposits: vi.fn(), verify: vi.fn(), verifyMany: vi.fn(), verifyDeposit: vi.fn(), rejectDeposit: vi.fn() }));
vi.mock('../../services/collections.service', () => ({ collectionsService: svc }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true, user: { role: 'accountant' } }) }));

const col = (id: number, orderId: number, amount: number) => ({ id, orderId, amount, allocatedAmount: 0, status: 'draft', collectionDate: '2026-10-20T10:00:00Z' });
const dep = { id: 5, amount: 300, status: 'pending', depositDate: '2026-10-21T10:00:00Z', depositMethod: 'cash', referenceNumber: 'MM-77', receiptUrl: null, rejectReason: null };
const onChanged = vi.fn();
const open = () => render(<ToastProvider><CollectionActionModal agentId={7} agentName="Kofi Appiah" onClose={vi.fn()} onChanged={onChanged} /></ToastProvider>);
const refuse = (message: string) => Object.assign(new axios.AxiosError('refused'), { response: { status: 409, data: { error: message } } });

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  onChanged.mockReset();
  useConfigStore.setState({ currency: 'GHS' });
  svc.toVerify.mockResolvedValue([col(1, 101, 200), col(2, 102, 150)]);
  svc.deposits.mockResolvedValue([dep]);
  svc.verify.mockResolvedValue(undefined);
  svc.verifyMany.mockResolvedValue(undefined);
  svc.verifyDeposit.mockResolvedValue(undefined);
  svc.rejectDeposit.mockResolvedValue(undefined);
});

describe('Review modal (M5-T36, F-912)', () => {
  it('verify reconciles one collection in one step and reloads the page figures; no approve button', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify order #101' }));
    await waitFor(() => expect(svc.verify).toHaveBeenCalledWith(1));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('verifies the selected collections together', async () => {
    open();
    await userEvent.click(await screen.findByLabelText('Select all on this page'));
    await userEvent.click(screen.getByRole('button', { name: 'Verify selected (2)' }));
    await waitFor(() => expect(svc.verifyMany).toHaveBeenCalledWith([1, 2]));
  });

  it('shows the server sentence when a verify is refused', async () => {
    svc.verify.mockRejectedValue(refuse('Already verified'));
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Verify order #101' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Already verified');
  });

  it('reject needs a reason of at least 5 characters, then sends it', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: /Pay-ins/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject pay-in MM-77' }));
    const go = screen.getByRole('button', { name: 'Reject pay-in' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why reject MM-77/), 'abc');
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why reject MM-77/), 'de');
    await userEvent.click(go);
    await waitFor(() => expect(svc.rejectDeposit).toHaveBeenCalledWith(5, 'abcde'));
  });

  it('says so when there is nothing to verify', async () => {
    svc.toVerify.mockResolvedValue([]);
    open();
    expect(await screen.findByText('Nothing to verify')).toBeInTheDocument();
  });
});
