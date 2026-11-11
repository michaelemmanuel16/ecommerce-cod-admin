import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/ui-v2';
import { OperationsTab } from '../../pages/settings/OperationsTab';
import { adminService, type OperationsSettings } from '../../services/admin.service';

const getOperationsSettings = vi.fn();
const updateOperationsSettings = vi.fn();

vi.mock('../../services/admin.service', () => ({
  adminService: {
    getOperationsSettings: (...args: unknown[]) => getOperationsSettings(...args),
    updateOperationsSettings: (...args: unknown[]) => updateOperationsSettings(...args),
  },
}));

const INITIAL_SETTINGS: OperationsSettings = {
  timeZone: 'Africa/Accra',
  queueWaitAlertMinutes: 30,
  firstCallTargetMinutes: 15,
  defaultDaysToPay: 7,
  lowStockCoverDays: 14,
  operatingHours: {
    days: {
      monday: { open: '08:00', close: '20:00', enabled: true },
      tuesday: { open: '08:00', close: '20:00', enabled: true },
      wednesday: { open: '08:00', close: '20:00', enabled: true },
      thursday: { open: '08:00', close: '20:00', enabled: true },
      friday: { open: '08:00', close: '20:00', enabled: true },
      saturday: { open: '09:00', close: '18:00', enabled: true },
      sunday: { open: '10:00', close: '16:00', enabled: false },
    },
    queueWaitAlertMinutes: 30,
    firstCallTargetMinutes: 15,
    defaultDaysToPay: 7,
    lowStockCoverDays: 14,
  },
};

function renderTab(editable = true) {
  return render(
    <ToastProvider>
      <OperationsTab editable={editable} />
    </ToastProvider>,
  );
}

describe('Settings Operations tab (M7-T21, F-1229)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOperationsSettings.mockResolvedValue(INITIAL_SETTINGS);
  });

  it('renders operating hours, queue rules and public holidays help text', async () => {
    renderTab();

    expect(await screen.findByText('Operating hours')).toBeInTheDocument();
    expect(screen.getByText('When reps take calls')).toBeInTheDocument();
    expect(screen.getByText('Public holidays are not counted yet.')).toBeInTheDocument();

    // Weekdays rendered
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      expect(screen.getByText(day)).toBeInTheDocument();
      expect(screen.getByLabelText(`${day} opens`)).toBeInTheDocument();
      expect(screen.getByLabelText(`${day} closes`)).toBeInTheDocument();
      expect(screen.getByLabelText(`${day} open`)).toBeInTheDocument();
    }

    // Rules
    expect(screen.getByLabelText('Queue wait alert (minutes)')).toHaveValue(30);
    expect(screen.getByLabelText('Time to first call target (minutes)')).toHaveValue(15);
    expect(screen.getByLabelText('Default days to pay')).toHaveValue(7);
    expect(screen.getByLabelText('Low stock alert (days of cover)')).toHaveValue(14);
  });

  it('saves all keys and reloads updated values', async () => {
    renderTab();
    await screen.findByText('Operating hours');

    const queueAlert = screen.getByLabelText('Queue wait alert (minutes)');
    // The inputs stay disabled until the settings load; on a slow runner the heading shows first.
    await waitFor(() => expect(queueAlert).toBeEnabled());
    await userEvent.clear(queueAlert);
    await userEvent.type(queueAlert, '45');

    const firstCall = screen.getByLabelText('Time to first call target (minutes)');
    await userEvent.clear(firstCall);
    await userEvent.type(firstCall, '20');

    const daysToPay = screen.getByLabelText('Default days to pay');
    await userEvent.clear(daysToPay);
    await userEvent.type(daysToPay, '10');

    const lowStock = screen.getByLabelText('Low stock alert (days of cover)');
    await userEvent.clear(lowStock);
    await userEvent.type(lowStock, '21');

    // Auto-confirm is sent by a workflow action, not a setting
    expect(screen.queryByLabelText(/auto-confirm/i)).toBeNull();

    // Toggle Sunday open
    const sundaySwitch = screen.getByLabelText('Sunday open');
    await userEvent.click(sundaySwitch);

    const updatedResponse: OperationsSettings = {
      ...INITIAL_SETTINGS,
      queueWaitAlertMinutes: 45,
      firstCallTargetMinutes: 20,
      defaultDaysToPay: 10,
      lowStockCoverDays: 21,
      operatingHours: {
        ...INITIAL_SETTINGS.operatingHours!,
        queueWaitAlertMinutes: 45,
        firstCallTargetMinutes: 20,
        defaultDaysToPay: 10,
        lowStockCoverDays: 21,
        days: {
          ...INITIAL_SETTINGS.operatingHours!.days,
          sunday: { open: '10:00', close: '16:00', enabled: true },
        },
      },
    };
    updateOperationsSettings.mockResolvedValueOnce(updatedResponse);

    const saveButton = screen.getByRole('button', { name: 'Save operations' });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(updateOperationsSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          queueWaitAlertMinutes: 45,
          firstCallTargetMinutes: 20,
          defaultDaysToPay: 10,
          lowStockCoverDays: 21,
          operatingHours: expect.objectContaining({
            queueWaitAlertMinutes: 45,
            firstCallTargetMinutes: 20,
            defaultDaysToPay: 10,
            lowStockCoverDays: 21,
            days: expect.objectContaining({
              sunday: expect.objectContaining({ enabled: true }),
            }),
          }),
        }),
      );
    });

    // Reloaded values in form
    await waitFor(() => {
      expect(screen.getByLabelText('Queue wait alert (minutes)')).toHaveValue(45);
      expect(screen.getByLabelText('Time to first call target (minutes)')).toHaveValue(20);
      expect(screen.getByLabelText('Default days to pay')).toHaveValue(10);
      expect(screen.getByLabelText('Low stock alert (days of cover)')).toHaveValue(21);
    });
  });

  it('shows server error inline when overnight hours are rejected', async () => {
    renderTab();
    await screen.findByText('Operating hours');

    // Change Monday close to 07:00 (before 08:00 open)
    const mondayClose = screen.getByLabelText('Monday closes');
    await userEvent.clear(mondayClose);
    await userEvent.type(mondayClose, '07:00');

    const serverErrorMessage = 'operatingHours.days.monday: close must be after open';
    updateOperationsSettings.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          success: false,
          message: serverErrorMessage,
          code: 'INVALID_OPERATING_HOURS',
        },
      },
    });

    const saveButton = screen.getByRole('button', { name: 'Save operations' });
    await userEvent.click(saveButton);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(serverErrorMessage);
    expect(alert).toHaveClass('opserr');
  });

  it('allows closed days (disabled weekdays)', async () => {
    renderTab();
    await screen.findByText('Operating hours');

    // Disable Saturday and Monday
    const satSwitch = screen.getByLabelText('Saturday open');
    await userEvent.click(satSwitch);

    updateOperationsSettings.mockResolvedValueOnce({
      ...INITIAL_SETTINGS,
      operatingHours: {
        ...INITIAL_SETTINGS.operatingHours!,
        days: {
          ...INITIAL_SETTINGS.operatingHours!.days,
          saturday: { open: '09:00', close: '18:00', enabled: false },
        },
      },
    });

    const saveButton = screen.getByRole('button', { name: 'Save operations' });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(updateOperationsSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          operatingHours: expect.objectContaining({
            days: expect.objectContaining({
              saturday: expect.objectContaining({ enabled: false }),
            }),
          }),
        }),
      );
    });
  });

  it('disables inputs and hides save button when editable is false', async () => {
    renderTab(false);
    await screen.findByText('Operating hours');

    expect(screen.getByLabelText('Queue wait alert (minutes)')).toBeDisabled();
    expect(screen.getByLabelText('Time to first call target (minutes)')).toBeDisabled();
    expect(screen.getByLabelText('Default days to pay')).toBeDisabled();
    expect(screen.getByLabelText('Low stock alert (days of cover)')).toBeDisabled();
    expect(screen.getByLabelText('Monday opens')).toBeDisabled();
    expect(screen.getByLabelText('Monday closes')).toBeDisabled();
    expect(screen.getByLabelText('Monday open')).toBeDisabled();

    expect(screen.queryByRole('button', { name: 'Save operations' })).not.toBeInTheDocument();
  });
});
