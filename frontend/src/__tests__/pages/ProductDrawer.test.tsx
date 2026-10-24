import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductDrawer } from '../../pages/products/ProductDrawer';
import { ToastProvider } from '../../components/ui-v2';
import { useConfigStore } from '../../stores/configStore';
import { DETAIL } from '../fixtures/productsPage';

const detail = vi.fn();
const create = vi.fn();
const update = vi.fn();
const archive = vi.fn();
const restore = vi.fn();
const stockLocations = vi.fn();
vi.mock('../../services/products.service', async (orig) => ({
  ...(await orig<typeof import('../../services/products.service')>()),
  productsService: {
    detail: (...a: unknown[]) => detail(...a),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    archive: (...a: unknown[]) => archive(...a),
    restore: (...a: unknown[]) => restore(...a),
    stockLocations: (...a: unknown[]) => stockLocations(...a),
  },
}));

const onClose = vi.fn();
const onChanged = vi.fn();
const open = (target: number | 'new' = 'new', canStock = true) =>
  render(<ToastProvider><ProductDrawer target={target} canStock={canStock} onClose={onClose} onChanged={onChanged} /></ToastProvider>);
const drawer = () => screen.getByRole('dialog', { name: /product/i, hidden: true });

beforeEach(() => {
  [detail, create, update, archive, restore, stockLocations, onClose, onChanged].forEach((m) => m.mockReset());
  detail.mockResolvedValue(DETAIL);
  create.mockResolvedValue({ id: 99, name: 'Bolts' });
  update.mockResolvedValue({ id: 1 });
  stockLocations.mockResolvedValue([{ id: 5, name: 'Own store', type: 'own_store' }, { id: 10, name: 'Logiswift', type: 'partner_3pl' }]);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
});

describe('Product drawer (M4-T22)', () => {
  it('a new product: live margin, starting stock with a holder, sent as openingStock', async () => {
    open('new');
    expect(drawer()).toHaveAccessibleName('Add product');
    await userEvent.type(screen.getByLabelText('Product name'), 'Bolts');
    await userEvent.type(screen.getByLabelText('SKU'), 'bolt-1');
    await userEvent.type(screen.getByLabelText('Category'), 'Hardware');
    await userEvent.type(screen.getByLabelText('Selling price'), '50');
    await userEvent.type(screen.getByLabelText('Cost per unit'), '20');
    expect(screen.getByTestId('live-margin')).toHaveTextContent('60%');
    await userEvent.type(screen.getByLabelText('Starting stock'), '20');
    await waitFor(() => expect(screen.getByLabelText('Holder')).toHaveValue('10')); // the first 3PL
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({
      productType: 'physical', name: 'Bolts', sku: 'BOLT-1', category: 'Hardware', price: 50, cogs: 20, openingStock: { locationId: 10, quantity: 20 },
    });
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when the margin is negative', async () => {
    open('new');
    await userEvent.type(screen.getByLabelText('Selling price'), '10');
    await userEvent.type(screen.getByLabelText('Cost per unit'), '30');
    expect(screen.getByText('Margin is negative')).toBeInTheDocument();
  });

  it('a product with orders has its type locked; one with a received shipment has its cost read only', async () => {
    open(1);
    await waitFor(() => expect(screen.getByLabelText('Product name')).toHaveValue('Magic Groove copybook set'));
    expect(screen.getByRole('button', { name: 'Physical' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Digital' })).toBeDisabled();
    expect(screen.getByText('The type cannot change once the product has orders.')).toBeInTheDocument();
    expect(screen.getByLabelText('Cost per unit')).toHaveAttribute('readonly');
    expect(screen.getByText('Set by the landed cost of the received shipments.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Starting stock')).not.toBeInTheDocument();
  });

  it('a fresh product with no orders or shipments can change type and cost', async () => {
    detail.mockResolvedValue({ ...DETAIL, hasOrders: false, hasReceivedShipment: false });
    open(1);
    await waitFor(() => expect(screen.getByLabelText('Product name')).toHaveValue('Magic Groove copybook set'));
    expect(screen.getByRole('button', { name: 'Digital' })).toBeEnabled();
    expect(screen.getByLabelText('Cost per unit')).not.toHaveAttribute('readonly');
  });

  it('shows no cost field for a role the API gives no cost', async () => {
    const { cogs: _c, marginPct: _m, ...noCost } = DETAIL;
    detail.mockResolvedValue(noCost);
    open(1);
    await waitFor(() => expect(screen.getByLabelText('Product name')).toHaveValue('Magic Groove copybook set'));
    expect(screen.queryByLabelText('Cost per unit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-margin')).not.toBeInTheDocument();
  });

  it('a digital product asks for the file URL, expiry and max downloads', async () => {
    open('new');
    await userEvent.click(screen.getByRole('button', { name: 'Digital' }));
    expect(screen.queryByLabelText('Starting stock')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Max downloads')).toHaveValue(5);
    expect(screen.getByLabelText('Link expires after (hours)')).toHaveValue(72);
    await userEvent.type(screen.getByLabelText('Product name'), 'Guide');
    await userEvent.type(screen.getByLabelText('SKU'), 'guide-1');
    await userEvent.type(screen.getByLabelText('Category'), 'Guides');
    await userEvent.type(screen.getByLabelText('Selling price'), '59');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('The file URL is required')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('File URL'), 'https://files.test/g.pdf');
    await userEvent.clear(screen.getByLabelText('Max downloads'));
    await userEvent.type(screen.getByLabelText('Max downloads'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0]).toMatchObject({ productType: 'digital', digitalFileUrl: 'https://files.test/g.pdf', downloadLinkExpiryHours: 72, maxDownloads: 3 });
    expect(create.mock.calls[0][0].openingStock).toBeUndefined();
  });

  it('archive confirms, then says how many open orders and units on hand the product still has; restore undoes it', async () => {
    archive.mockResolvedValue({ product: { id: 1, name: 'Magic Groove copybook set' }, openOrders: 3, unitsOnHand: 40 });
    restore.mockResolvedValue(undefined);
    open(1);
    await waitFor(() => expect(screen.getByLabelText('Product name')).toHaveValue('Magic Groove copybook set'));
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Archive Magic Groove copybook set?');
    expect(archive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('alertdialog').querySelector('.danger') as HTMLElement);
    await waitFor(() => expect(archive).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/3 open orders, 40 units on hand/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(1));
    expect(screen.queryByText(/open orders/)).not.toBeInTheDocument();
  });
});
