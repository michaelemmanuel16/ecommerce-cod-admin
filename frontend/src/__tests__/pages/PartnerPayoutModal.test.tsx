import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { PartnerPayoutModal } from '../../pages/deliveries/PartnerPayoutModal';
import { PartnerDrawer } from '../../pages/deliveries/PartnerDrawer';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { ManualPayoutPreview } from '../../services/partner-settlements.service';
import type { PartnerDetail } from '../../services/delivery-partners.service';
import { PARTNERS } from '../fixtures/deliveriesList';

const previewManual = vi.fn();
const recordManual = vi.fn();
vi.mock('../../services/partner-settlements.service', () => ({
  partnerSettlementsService: { previewManual: (...a: unknown[]) => previewManual(...a), recordManual: (...a: unknown[]) => recordManual(...a) },
}));
const get = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: { get: (...a: unknown[]) => get(...a) },
}));
let canCreate = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (r: string, a: string) => (r === 'payouts' && a === 'create' ? canCreate : true) }) }));

/** Unpaid total GH₵300 over two orders: what the server sends after the client turns money strings into numbers. */
const planFor = (amount: number): ManualPayoutPreview => {
  const applied = Math.min(amount, 300);
  return {
    unpaidTotal: 300, appliedAmount: applied, unappliedAmount: Math.max(amount - 300, 0), leftUnpaid: 300 - applied,
    orders: [{ orderId: 101, applied: Math.min(applied, 200), clearsOrder: applied >= 200 }, ...(applied > 200 ? [{ orderId: 102, applied: applied - 200, clearsOrder: applied >= 300 }] : [])],
  };
};

const onClose = vi.fn();
const onRecorded = vi.fn();
const modal = () => render(<ToastProvider><PartnerPayoutModal partnerId={2} partnerName="Logiswift" onClose={onClose} onRecorded={onRecorded} /></ToastProvider>);
const type = async (label: string, text: string) => userEvent.type(screen.getByLabelText(label), text);
const saveButton = () => screen.getByRole('button', { name: 'Record payout' });
const refuse = (message: string, status = 409) => Object.assign(new axios.AxiosError('refused'), { response: { status, data: { error: message } } });

beforeEach(() => {
  [previewManual, recordManual, onClose, onRecorded].forEach((m) => m.mockReset());
  canCreate = true;
  useConfigStore.setState({ currency: 'GHS' });
  previewManual.mockImplementation((_id: number, amount: string) => Promise.resolve(planFor(Number(amount))));
  recordManual.mockResolvedValue({ unappliedAmount: 0 });
});

describe('PartnerPayoutModal (M5-T37, F-908)', () => {
  it('shows the unapplied warning before save when the amount is above the unpaid total', async () => {
    modal();
    await type('Amount', '350');
    expect(await screen.findByTestId('unapplied-warning')).toHaveTextContent('GH₵50 will be held as unapplied');
    expect(previewManual).toHaveBeenLastCalledWith(2, '350.00');
    expect(recordManual).not.toHaveBeenCalled();
  });

  it('shows no warning for an amount at or below the unpaid total, and lists the orders it pays', async () => {
    modal();
    await type('Amount', '300');
    const plan = await screen.findByRole('region', { name: 'Orders this payout pays' });
    expect(plan).toHaveTextContent('#101');
    expect(plan).toHaveTextContent('#102');
    expect(screen.queryByTestId('unapplied-warning')).not.toBeInTheDocument();
  });

  it('asks for the preview once after typing stops', async () => {
    modal();
    await type('Amount', '150');
    await screen.findByRole('region', { name: 'Orders this payout pays' });
    expect(previewManual).toHaveBeenCalledTimes(1);
    expect(previewManual).toHaveBeenCalledWith(2, '150.00');
  });

  it('saves with partner, amount, date and reference, then reloads the page data and closes', async () => {
    modal();
    await type('Amount', '300');
    await type('Reference or receipt', 'MM-1');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    await userEvent.click(saveButton());
    await waitFor(() => expect(recordManual).toHaveBeenCalledTimes(1));
    expect(recordManual).toHaveBeenCalledWith({
      partnerId: 2, amount: '300', reference: 'MM-1', payoutDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRecorded).toHaveBeenCalled();
  });

  it('blocks save without a reference', async () => {
    modal();
    await type('Amount', '100');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId('blocked-reason')).toHaveTextContent('Enter the reference or receipt number');
  });

  it('shows a server refusal in the modal and stays open', async () => {
    recordManual.mockRejectedValue(refuse('This reference was used on 2026-10-20'));
    modal();
    await type('Amount', '100');
    await type('Reference or receipt', 'MM-1');
    await userEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('This reference was used on 2026-10-20');
    expect(onClose).not.toHaveBeenCalled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('closes on Escape and the close button is labelled', async () => {
    modal();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Record payout button on the partner drawer', () => {
  const KOFI = {
    id: 2, name: 'Kofi Appiah', firstName: 'Kofi', lastName: 'Appiah', email: 'k@x.test', phoneNumber: null, kind: 'person', type: 'agent',
    isActive: true, isAvailable: true, vehicleType: null, vehicleId: null,
    profile: { daysToPay: 2, isTrial: false, dataSource: 'app', baseTown: null }, stockLocation: null,
  } as PartnerDetail;
  const drawer = () => render(
    <MemoryRouter>
      <ToastProvider>
        <PartnerDrawer id={2} row={PARTNERS[1]} target={60} canEdit canSwitch onClose={vi.fn()} onChanged={vi.fn()} onFeeRulesSaved={vi.fn()} />
      </ToastProvider>
    </MemoryRouter>,
  );

  it('is disabled with a reason for a user without payouts:create', async () => {
    canCreate = false;
    get.mockResolvedValue(KOFI);
    drawer();
    const button = await screen.findByRole('button', { name: 'Record payout' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('You do not have permission to record payouts.');
    await userEvent.click(button);
    expect(screen.queryByRole('dialog', { name: /Record partner payout/ })).not.toBeInTheDocument();
  });

  it('opens the modal for a user who holds the permission', async () => {
    canCreate = true;
    get.mockResolvedValue(KOFI);
    drawer();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payout' }));
    expect(await screen.findByRole('dialog', { name: /Record partner payout: Kofi Appiah/ })).toBeInTheDocument();
  });
});
