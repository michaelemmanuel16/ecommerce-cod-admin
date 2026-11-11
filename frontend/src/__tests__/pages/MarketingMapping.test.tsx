import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Marketing } from '../../pages/Marketing';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useConfigStore } from '../../stores/configStore';
import { campaignRow, funnel, productRow, summary, totals } from '../fixtures/marketing';

const svc = vi.hoisted(() => ({
  summary: vi.fn(), funnel: vi.fn(), products: vi.fn(), campaigns: vi.fn(), unmapped: vi.fn(), setPick: vi.fn(), addRule: vi.fn(),
}));
const meta = vi.hoisted(() => ({ getAccounts: vi.fn() }));
const catalog = vi.hoisted(() => ({ getProducts: vi.fn() }));
vi.mock('../../services/marketing.service', () => ({ marketingService: svc }));
vi.mock('../../services/metaAds.service', () => ({ metaAdsService: meta }));
vi.mock('../../services/products.service', () => ({ productsService: catalog }));

let canUpdate = true;
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ can: (r: string, a: string) => r === 'marketing' && (a === 'view' || canUpdate) }),
}));

const unmappedRows = [
  { adAccountId: 1, campaignId: 'id-MG_Oct_Retarget', campaignName: 'MG_Oct_Retarget', currency: 'NGN', spend: '41000.0000' },
  { adAccountId: 1, campaignId: 'id-XX_none', campaignName: 'XX_none', currency: 'NGN', spend: '9000.0000' },
];

const renderPage = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/marketing']}>
      <Routes><Route path="/marketing" element={<Marketing />} /></Routes>
    </MemoryRouter>
  </ToastProvider>,
);

const openStripDialog = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Map campaigns' }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  vi.clearAllMocks();
  clearBlockCache();
  canUpdate = true;
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  meta.getAccounts.mockResolvedValue([{ id: 1, accountId: '1', name: 'Main', currency: 'NGN', timezone: 'UTC', enabled: true, status: 'connected', lastPulledAt: null }]);
  svc.summary.mockResolvedValue(summary());
  svc.funnel.mockResolvedValue(funnel());
  svc.products.mockResolvedValue([productRow()]);
  svc.campaigns.mockResolvedValue({ campaigns: [campaignRow('MG_Oct_Retarget', 'Not mapped'), campaignRow('MG_win', 'Winning')], totals: totals() });
  svc.unmapped.mockResolvedValue({ campaigns: unmappedRows, spendByCurrency: { NGN: '50000.0000' } });
  svc.setPick.mockResolvedValue(undefined);
  svc.addRule.mockResolvedValue(undefined);
  catalog.getProducts.mockResolvedValue([
    { id: 7, name: 'Magic Groove', isActive: true }, { id: 8, name: 'Refill pens', isActive: true }, { id: 9, name: 'Pile Combo', isActive: false },
  ]);
});

describe('Not mapped strip and mapping dialog', () => {
  it('shows the strip with the total and the count', async () => {
    renderPage();
    expect(await screen.findByText(/₦50,000 Meta spend has no product\. 2 campaigns are not mapped\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Map campaigns' })).toBeInTheDocument();
  });

  it('saves a one-campaign pick, refetches the tables and says "Mapping saved"', async () => {
    renderPage();
    const dialog = await openStripDialog();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Magic Groove' })).toBeInTheDocument());
    expect(within(dialog).queryByRole('option', { name: 'Pile Combo' })).not.toBeInTheDocument(); // archived products are not offered
    await userEvent.selectOptions(within(dialog).getByLabelText('Product'), 'Magic Groove');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save mapping' }));
    await waitFor(() => expect(svc.setPick).toHaveBeenCalledWith({ adAccountId: 1, campaignId: 'id-MG_Oct_Retarget', productId: 7 }));
    expect(await screen.findByText('Mapping saved')).toBeInTheDocument();
    await waitFor(() => {
      expect(svc.campaigns).toHaveBeenCalledTimes(2);
      expect(svc.products).toHaveBeenCalledTimes(2);
      expect(svc.unmapped).toHaveBeenCalledTimes(2);
      expect(svc.funnel).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves a name rule with the prefix up to the first underscore, editable', async () => {
    renderPage();
    const dialog = await openStripDialog();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Refill pens' })).toBeInTheDocument());
    await userEvent.selectOptions(within(dialog).getByLabelText('Product'), 'Refill pens');
    await userEvent.click(within(dialog).getByLabelText(/All campaigns whose name starts with/));
    const prefix = within(dialog).getByLabelText('Name starts with');
    expect(prefix).toHaveValue('MG_');
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'MG_Oct_');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save mapping' }));
    await waitFor(() => expect(svc.addRule).toHaveBeenCalledWith({ prefix: 'MG_Oct_', productId: 8 }));
    expect(svc.setPick).not.toHaveBeenCalled();
    await waitFor(() => expect(svc.campaigns).toHaveBeenCalledTimes(2));
  });

  it('shows the server sentence when a rule is refused and keeps the dialog open', async () => {
    svc.addRule.mockRejectedValue({ response: { data: { message: 'This prefix is already mapped.' } } });
    renderPage();
    const dialog = await openStripDialog();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Magic Groove' })).toBeInTheDocument());
    await userEvent.selectOptions(within(dialog).getByLabelText('Product'), 'Magic Groove');
    await userEvent.click(within(dialog).getByLabelText(/All campaigns whose name starts with/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save mapping' }));
    expect(await within(dialog).findByText('This prefix is already mapped.')).toBeInTheDocument();
    expect(svc.campaigns).toHaveBeenCalledTimes(1);
  });

  it('opens from a Not mapped chip, and a mapped campaign can have its mapping removed', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Map MG_Oct_Retarget to a product' }));
    expect(within(await screen.findByRole('dialog')).queryByRole('button', { name: 'Remove mapping' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Change product of MG_win' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove mapping' }));
    await waitFor(() => expect(svc.setPick).toHaveBeenCalledWith({ adAccountId: 1, campaignId: 'id-MG_win', productId: null }));
  });

  it('warns when the mapped product is archived', async () => {
    svc.campaigns.mockResolvedValue({
      campaigns: [campaignRow('MG_old', 'Winning', { product: { id: 9, name: 'Pile Combo', archived: true } })], totals: totals(),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Change product of MG_old' }));
    expect(await screen.findByText(/Pile Combo is archived/)).toBeInTheDocument();
  });

  it('shows the strip text but no Map button, chip button or dialog trigger to a read-only user', async () => {
    canUpdate = false;
    renderPage();
    expect(await screen.findByText(/Meta spend has no product/)).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Campaigns' });
    expect(screen.queryByRole('button', { name: 'Map campaigns' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Map MG_Oct_Retarget/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change product of/ })).not.toBeInTheDocument();
  });

  it('shows no strip when every campaign has a product', async () => {
    svc.unmapped.mockResolvedValue({ campaigns: [], spendByCurrency: {} });
    renderPage();
    await screen.findByRole('table', { name: 'Campaigns' });
    expect(screen.queryByText(/Meta spend has no product/)).not.toBeInTheDocument();
  });
});
