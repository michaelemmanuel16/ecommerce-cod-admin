import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PaystackIntegration } from '../../components/settings/integrations/PaystackIntegration';
import { adminService, SystemConfig } from '../../services/admin.service';

vi.mock('../../services/admin.service', () => ({
  adminService: {
    updateSystemConfig: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const baseConfig: SystemConfig = {
  id: '1',
  currency: 'GHS',
  createdAt: '',
  updatedAt: '',
  tenantSlug: 'acme',
  paystackProvider: {
    publicKey: 'pk_test_abc',
    secretKey: '••••••••',
    mode: 'test',
    isEnabled: true,
  },
};

describe('PaystackIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the masked secret-key value when keys are already saved', () => {
    render(<PaystackIntegration systemConfig={baseConfig} onConfigSaved={() => {}} />);
    const secretInput = screen.getByPlaceholderText(/Paystack secret key/i) as HTMLInputElement;
    expect(secretInput.value).toBe('••••••••');
    expect(secretInput.type).toBe('password');
  });

  it('renders the per-tenant webhook URL using the tenant slug', () => {
    const { container } = render(
      <PaystackIntegration systemConfig={baseConfig} onConfigSaved={() => {}} />,
    );
    const codeBlocks = container.querySelectorAll('code');
    const hasWebhookUrl = Array.from(codeBlocks).some((el) =>
      el.textContent?.includes('/api/paystack/webhook/acme'),
    );
    expect(hasWebhookUrl).toBe(true);
  });

  it('omits the webhook URL block when no tenant slug is set', () => {
    render(
      <PaystackIntegration
        systemConfig={{ ...baseConfig, tenantSlug: null }}
        onConfigSaved={() => {}}
      />,
    );
    expect(screen.queryByText(/Your Webhook URL/i)).not.toBeInTheDocument();
  });

  it('persists the selected mode (test/live) on save', async () => {
    (adminService.updateSystemConfig as any).mockResolvedValue(baseConfig);
    const onSaved = vi.fn();
    render(<PaystackIntegration systemConfig={baseConfig} onConfigSaved={onSaved} />);

    const modeSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(modeSelect, { target: { value: 'live' } });

    const saveBtn = screen.getByRole('button', { name: /Save Paystack Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(adminService.updateSystemConfig).toHaveBeenCalledWith({
        paystackProvider: expect.objectContaining({ mode: 'live' }),
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });
});
