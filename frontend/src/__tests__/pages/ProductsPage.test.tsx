import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Products } from '../../pages/Products';
import { resetStockLocations } from '../../pages/products/useStockLocations';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { COPYBOOK, DETAIL, GUIDE, HOLDERS, PENS, PRODUCT_LIST, SUMMARY, PENDING, RECEIVED, SHIP_SUMMARY } from '../fixtures/productsPage';

const list = vi.fn();
const summary = vi.fn();
const holders = vi.fn();
const detail = vi.fn();
const create = vi.fn();
const update = vi.fn();
const archive = vi.fn();
const restore = vi.fn();
const stockLocations = vi.fn();
vi.mock('../../services/products.service', async (orig) => ({
  ...(await orig<typeof import('../../services/products.service')>()),
  productsService: {
    list: (...a: unknown[]) => list(...a),
    summary: (...a: unknown[]) => summary(...a),
    holders: (...a: unknown[]) => holders(...a),
    detail: (...a: unknown[]) => detail(...a),
    create: (...a: unknown[]) => create(...a),
    update: (...a: unknown[]) => update(...a),
    archive: (...a: unknown[]) => archive(...a),
    restore: (...a: unknown[]) => restore(...a),
    stockLocations: (...a: unknown[]) => stockLocations(...a),
  },
}));
vi.mock('../../services/shipments.service', async (orig) => ({
  ...(await orig<typeof import('../../services/shipments.service')>()),
  shipmentsService: { list: vi.fn(async () => [PENDING, RECEIVED]), summary: vi.fn(async () => SHIP_SUMMARY) },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/products') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/products" element={<Products />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const withoutCost = (p: typeof COPYBOOK) => {
  const { cogs: _c, marginPct: _m, ...rest } = p;
  return rest;
};

beforeEach(() => {
  resetStockLocations();
  [list, summary, holders, detail, create, update, archive, restore, stockLocations].forEach((m) => m.mockReset());
  list.mockResolvedValue(PRODUCT_LIST);
  summary.mockResolvedValue(SUMMARY);
  holders.mockResolvedValue(HOLDERS);
  detail.mockResolvedValue(DETAIL);
  stockLocations.mockResolvedValue([{ id: 10, name: 'Logiswift', type: 'partner_3pl' }]);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: {} });
});

describe('Products page (M4-T21)', () => {
  it('shows the four tiles from the summary', async () => {
    renderPage();
    const tile = async (label: string) => (await screen.findByText(label, { selector: '.kpi .l' })).closest('.kpi') as HTMLElement;
    expect(await tile('Active products')).toHaveTextContent('3');
    expect(await tile('Best seller this month')).toHaveTextContent('Magic Groove copybook set');
    expect(await tile('Best seller this month')).toHaveTextContent('306 delivered');
    expect(await tile('Average margin')).toHaveTextContent('86%');
    expect(await tile('Low stock')).toHaveTextContent('1');
  });

  it('lists the rows with price, cost, margin, cover and a status tag', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Products' });
    const row = within(table).getByText('Magic Groove copybook set').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('GH₵249');
    expect(row).toHaveTextContent('GH₵30');
    expect(row).toHaveTextContent('88%');
    expect(row).toHaveTextContent('7 days of cover');
    expect(row).toHaveTextContent('48%'); // under the 60% target of the summary
    expect(row).toHaveTextContent('Low stock');
    expect(within(table).getByText("Smart Parent's Home Study Guide").closest('tr')).toHaveTextContent('Digital');
  });

  it('tabs ask the server with the tab and show its counts', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Products' });
    expect(list).toHaveBeenCalledWith('active', null, false);
    expect(screen.getByRole('tab', { name: /Archived/ })).toHaveTextContent('2');
    await userEvent.click(screen.getByRole('tab', { name: /Archived/ }));
    await waitFor(() => expect(list).toHaveBeenCalledWith('archived', null, false));
    expect(screen.getByTestId('where')).toHaveTextContent('tab=archived');
  });

  it('the month picker asks for that month', async () => {
    renderPage('/products?month=2026-09');
    await screen.findByRole('table', { name: 'Products' });
    expect(list).toHaveBeenCalledWith('active', '2026-09', false);
    expect(summary).toHaveBeenCalledWith('2026-09', false);
  });

  it('has no cost or margin column, and no tiles, for a role the API gives no cost', async () => {
    list.mockResolvedValue({ ...PRODUCT_LIST, canSeeCost: false, products: [withoutCost(COPYBOOK), withoutCost(PENS)] });
    summary.mockRejectedValue(Object.assign(new Error('forbidden'), { isAxiosError: true, response: { status: 403 } }));
    renderPage();
    const table = await screen.findByRole('table', { name: 'Products' });
    expect(within(table).queryByRole('columnheader', { name: 'Cost' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Margin' })).not.toBeInTheDocument();
    expect(screen.queryByText('Average margin')).not.toBeInTheDocument();
    expect(screen.queryByText('Active products')).not.toBeInTheDocument();
  });

  it('the expansion shows the holders and the count gap, links to Inventory and has no Allocate or Transfer', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show stock by holder of Magic Groove copybook set' }));
    const holdersTable = await screen.findByRole('table', { name: 'Stock by holder' });
    expect(holdersTable).toHaveTextContent('Logiswift');
    expect(holdersTable).toHaveTextContent('Kofi Appiah');
    expect(holdersTable).toHaveTextContent('Total');
    expect(await screen.findByText(/Our records say 100 on hand at Logiswift\. The 3PL dashboard count of 15 Oct says 88\./)).toBeInTheDocument();
    expect(screen.getByText('Esi Badu and Kwesi Amoah hold none of this product right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Inventory/ })).toHaveAttribute('href', '/inventory?product=1');
    expect(screen.queryByRole('button', { name: /allocate|transfer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /allocate|transfer/i })).not.toBeInTheDocument();
    expect(holders).toHaveBeenCalledWith(1);
  });

  it('a digital row expands to the download details, with no holders call', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: `Show details of ${GUIDE.name}` }));
    expect(screen.getByText('Digital product, no stock to track')).toBeInTheDocument();
    expect(screen.getByText(/expires after 72 hours and can be used 5 times/)).toBeInTheDocument();
    expect(holders).not.toHaveBeenCalled();
  });

  it('the Incoming shipments tab shows the three tiles and the 15 columns', async () => {
    renderPage('/products?pane=shipments');
    expect(await screen.findByText('Pending shipments', { selector: '.kpi .l' })).toBeInTheDocument();
    expect((await screen.findByText('Units on the way', { selector: '.kpi .l' })).closest('.kpi')).toHaveTextContent('1,500');
    expect(screen.getByText('Cost to land them', { selector: '.kpi .l' }).closest('.kpi')).toHaveTextContent('GH₵24,950');
    const table = await screen.findByRole('table', { name: 'Incoming shipments' });
    expect(table.querySelectorAll('thead th')).toHaveLength(15);
  });
});
