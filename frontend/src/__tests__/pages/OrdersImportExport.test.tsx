import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Orders } from '../../pages/Orders';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { COUNTS, ROWS } from '../fixtures/ordersList';

/** M3-T48 (F-319, F-320): the Import modal and the Export menu on the Orders page. */
const listOrders = vi.fn();
const getCounts = vi.fn();
const checkImport = vi.fn();
const uploadOrders = vi.fn();
const exportList = vi.fn();
vi.mock('../../services/orders.service', () => ({
  ordersService: {
    listOrders: (...a: unknown[]) => listOrders(...a),
    getCounts: (...a: unknown[]) => getCounts(...a),
    checkImport: (...a: unknown[]) => checkImport(...a),
    uploadOrders: (...a: unknown[]) => uploadOrders(...a),
    exportList: (...a: unknown[]) => exportList(...a),
  },
}));
vi.mock('../../services/socket', () => ({ getSocket: () => null }));
vi.mock('../../services/products.service', () => ({ productsService: { getProducts: () => Promise.resolve([]) } }));
vi.mock('../../services/delivery-agents.service', () => ({ deliveryAgentsService: { getDeliveryAgents: () => Promise.resolve([]) } }));
vi.mock('../../services/customer-reps.service', () => ({ customerRepsService: { getCustomerReps: () => Promise.resolve([]) } }));
vi.mock('../../components/forms/OrderForm', () => ({ OrderForm: () => null }));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/orders') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/orders" element={<Orders />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const CHECK = {
  fileName: 'meta-leads.xlsx', total: 42, ready: 40, needFix: 2, duplicates: 0, note: null,
  problems: [
    { row: 17, problems: ['phone has 9 digits'] },
    { row: 31, problems: ['region "Ashante" is not a region. Did you mean Ashanti?'] },
  ],
  problemsCsv: 'a,problem\n1,bad\n',
};
const IDS = Array.from({ length: 40 }, (_, i) => 5000 + i);
const RESULT = {
  results: { success: 40, failed: 0, duplicates: 0, orderIds: IDS, errors: [] },
  total: 42, needFix: 2, note: null, problems: CHECK.problems, problemsCsv: CHECK.problemsCsv,
};

beforeEach(() => {
  [listOrders, getCounts, checkImport, uploadOrders, exportList].forEach((m) => m.mockReset());
  listOrders.mockImplementation((p: { page?: number; limit?: number }) =>
    Promise.resolve({ rows: ROWS, pagination: { page: p.page ?? 1, limit: p.limit ?? 25, total: 1445, pages: 58 } }));
  getCounts.mockResolvedValue(COUNTS);
  localStorage.clear();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'super_admin', firstName: 'Manny', lastName: 'A' } as never, permissions: null });
});

const openImport = async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Import/ }));
  return screen.getByLabelText('Choose a file to import') as HTMLInputElement;
};

describe('Import modal (F-319)', () => {
  it('step 1 checks the file and saves nothing: 40 ready, 2 need a fix', async () => {
    checkImport.mockResolvedValue(CHECK);
    const input = await openImport();
    expect(screen.getByText(/Up to 2,000 rows/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Download template/ })).toHaveAttribute('href', expect.stringContaining('customer_name%2Cphone%2Caddress%2Cregion%2Cproduct%2Cquantity%2Cprice%2Cstatus'));
    await userEvent.upload(input, new File(['x'], 'meta-leads.xlsx'));
    expect(await screen.findByText('40 ready')).toBeInTheDocument();
    expect(screen.getByText('2 need a fix')).toBeInTheDocument();
    expect(screen.getByText(/42 rows read. 40 ready to import./)).toBeInTheDocument();
    expect(screen.getByText('Row 17: phone has 9 digits')).toBeInTheDocument();
    expect(screen.getByText(/Did you mean Ashanti/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 40 orders' })).toBeEnabled();
    expect(uploadOrders).not.toHaveBeenCalled();
  });

  it('step 2 imports; the result screen counts and links to the imported orders, which can be cleared', async () => {
    checkImport.mockResolvedValue(CHECK);
    uploadOrders.mockResolvedValue(RESULT);
    const input = await openImport();
    await userEvent.upload(input, new File(['x'], 'meta-leads.xlsx'));
    await userEvent.click(await screen.findByRole('button', { name: 'Import 40 orders' }));
    expect(uploadOrders).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('40 successful')).toBeInTheDocument();
    expect(screen.getByText('2 failed')).toBeInTheDocument();
    expect(screen.getByText(/Successful 40. Failed 2. Duplicates 0./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download the rows to fix/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show the imported orders' }));
    expect(decodeURIComponent(screen.getByTestId('where').textContent ?? '')).toBe(`/orders?ids=${IDS.join(',')}`);
    expect(await screen.findByText(/Showing the 40 orders from your import/)).toBeInTheDocument();
    await waitFor(() => expect(listOrders.mock.calls.at(-1)?.[0]).toMatchObject({ ids: IDS.join(',') }));
    expect(listOrders.mock.calls.at(-1)?.[0]).not.toHaveProperty('startDate');

    await userEvent.click(screen.getByRole('button', { name: 'Show all orders' }));
    expect(screen.getByTestId('where').textContent).toBe('/orders');
    expect(screen.queryByText(/from your import/)).toBeNull();
  });

  it('shows the server sentence when the file is refused', async () => {
    checkImport.mockRejectedValue({ response: { data: { message: 'Split the file into parts of 2,000 rows.' } } });
    const input = await openImport();
    await userEvent.upload(input, new File(['x'], 'big.csv'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Split the file into parts of 2,000 rows.');
    expect(screen.getByRole('button', { name: /Import orders/ })).toBeDisabled();
  });

  it('a link with ids opens the filtered list', async () => {
    renderPage('/orders?ids=11,12,13');
    expect(await screen.findByText(/Showing the 3 orders from your import/)).toBeInTheDocument();
    expect(listOrders.mock.calls[0][0]).toMatchObject({ ids: '11,12,13' });
  });
});

describe('Export menu (F-320)', () => {
  it('offers CSV and Excel and exports with the current filters', async () => {
    exportList.mockResolvedValue('orders-2026-10-22.csv');
    renderPage('/orders?status=confirmed&q=abena');
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menuitem', { name: 'CSV' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Excel/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    expect(exportList).toHaveBeenCalledWith(expect.objectContaining({ status: ['confirmed'], search: 'abena' }), 'csv');
    expect(await screen.findByText('Exported 1,445 orders to orders-2026-10-22.csv')).toBeInTheDocument();
  });

  it('Excel asks for xlsx, and a refused export shows the server sentence', async () => {
    exportList.mockRejectedValue({ response: { data: { message: 'Narrow the date range.' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Excel/ }));
    expect(exportList).toHaveBeenCalledWith(expect.anything(), 'xlsx');
    expect(await screen.findByText('Narrow the date range.')).toBeInTheDocument();
  });
});
