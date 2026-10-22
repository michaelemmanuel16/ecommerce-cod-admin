import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BusinessTab } from '../../pages/settings/BusinessTab';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import type { SystemConfig } from '../../services/admin.service';

const updateSystemConfig = vi.fn();
vi.mock('../../services/admin.service', () => ({
  adminService: { updateSystemConfig: (...a: unknown[]) => updateSystemConfig(...a) },
}));

const CONFIG = {
  id: '1', currency: 'GHS', createdAt: '', updatedAt: '',
  businessName: 'Manny Dynamics Limited', businessEmail: 'hello@magicgroove.shop', businessPhone: '+234 803 555 0100',
  businessAddress: '14 Adeola Odeku Street', taxId: 'C0012345678', supportWhatsapp: '+233245550100', contactPerson: 'Manny',
  timeZone: 'Africa/Accra',
} as SystemConfig;

const fetchConfig = vi.fn();
const onSaved = vi.fn();
const onOpenCurrencies = vi.fn();

function renderTab(config: SystemConfig | null = CONFIG) {
  return render(
    <ToastProvider>
      <BusinessTab systemConfig={config} onSaved={onSaved} onOpenCurrencies={onOpenCurrencies} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  [updateSystemConfig, fetchConfig, onSaved, onOpenCurrencies].forEach((m) => m.mockReset());
  updateSystemConfig.mockResolvedValue(CONFIG);
  useConfigStore.setState({ fetchConfig } as never);
});

describe('Business details tab (M3-T65, F-1230)', () => {
  it('shows the saved fields, the time zone and no main product or average order value', () => {
    renderTab();
    expect(screen.getByLabelText('Business name')).toHaveValue('Manny Dynamics Limited');
    expect(screen.getByLabelText(/Contact person/)).toHaveValue('Manny');
    expect(screen.getByLabelText('Contact email')).toHaveValue('hello@magicgroove.shop');
    expect(screen.getByLabelText('Business phone')).toHaveValue('+234 803 555 0100');
    expect(screen.getByLabelText('Customer support WhatsApp')).toHaveValue('+233245550100');
    expect(screen.getByLabelText('Tax ID (TIN)')).toHaveValue('C0012345678');
    expect(screen.getByLabelText('Business address')).toHaveValue('14 Adeola Odeku Street');
    expect(screen.getByLabelText('Time zone')).toHaveValue('Africa/Accra');
    expect(screen.getByText(/A change applies to future days only/)).toBeInTheDocument();
    expect(screen.queryByText(/main product/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/average order value/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/currency/i)).not.toBeInTheDocument();
  });

  it('save sends the form, then reloads the config and the config store', async () => {
    renderTab();
    const whatsapp = screen.getByLabelText('Customer support WhatsApp');
    await userEvent.clear(whatsapp);
    await userEvent.type(whatsapp, '+233245550199');
    await userEvent.selectOptions(screen.getByLabelText('Time zone'), 'Africa/Lagos');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSystemConfig).toHaveBeenCalledWith(expect.objectContaining({
      businessName: 'Manny Dynamics Limited', supportWhatsapp: '+233245550199', timeZone: 'Africa/Lagos', contactPerson: 'Manny',
    })));
    expect(onSaved).toHaveBeenCalled();
    expect(fetchConfig).toHaveBeenCalled();
    expect(await screen.findByText('Business details saved')).toBeInTheDocument();
  });

  it('empty optional fields are sent as null', async () => {
    renderTab();
    await userEvent.clear(screen.getByLabelText(/Contact person/));
    await userEvent.clear(screen.getByLabelText('Customer support WhatsApp'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSystemConfig).toHaveBeenCalledWith(expect.objectContaining({ contactPerson: null, supportWhatsapp: null })));
  });

  it('an invalid WhatsApp number shows the server message and does not reload', async () => {
    updateSystemConfig.mockRejectedValue({ response: { data: { message: 'Support WhatsApp must be an international number' } } });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Support WhatsApp must be an international number');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a stored time zone outside the short list still shows', () => {
    renderTab({ ...CONFIG, timeZone: 'Africa/Dakar' });
    expect(screen.getByLabelText('Time zone')).toHaveValue('Africa/Dakar');
  });

  it('points to Currencies & FX for the country and currency', async () => {
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Open Currencies & FX' }));
    expect(onOpenCurrencies).toHaveBeenCalled();
  });
});
