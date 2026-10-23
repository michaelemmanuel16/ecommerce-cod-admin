import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Customers } from '../../pages/Customers';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { ROWS, SUMMARY } from '../fixtures/customersList';
import { SEARCH_DEBOUNCE_MS } from '../../utils/urlState';

const listCustomers = vi.fn();
const getSummary = vi.fn();
const getTowns = vi.fn();
const exportCustomers = vi.fn();
const createCustomer = vi.fn();
vi.mock('../../services/customers.service', () => ({
  customersService: {
    listCustomers: (...a: unknown[]) => listCustomers(...a),
    getSummary: (...a: unknown[]) => getSummary(...a),
    getTowns: (...a: unknown[]) => getTowns(...a),
    exportCustomers: (...a: unknown[]) => exportCustomers(...a),
    createCustomer: (...a: unknown[]) => createCustomer(...a),
  },
}));

vi.mock('../../services/locations.service', () => ({
  locationsService: { getTowns: () => Promise.resolve(['Kumasi', 'Obuasi']) },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/customers') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<div>CUSTOMER PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const answer = (rows = ROWS, total = 6420) => {
  listCustomers.mockImplementation((p: { page?: number; limit?: number }) =>
    Promise.resolve({ rows, pagination: { page: p.page ?? 1, limit: p.limit ?? 25, total, pages: Math.ceil(total / (p.limit ?? 25)) } }));
  getSummary.mockResolvedValue(SUMMARY);
};

beforeEach(() => {
  [listCustomers, getSummary, getTowns, exportCustomers, createCustomer].forEach((m) => m.mockReset());
  getTowns.mockResolvedValue(['Accra', 'Kumasi', 'Tema']);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: { customers: ['view', 'create', 'update', 'delete', 'export'] } });
  answer();
});

describe('Customers list: tiles and tabs (F-351)', () => {
  it('shows the four tiles and the five tabs from the one summary', async () => {
    renderPage();
    expect(await screen.findByText('Total customers')).toBeInTheDocument();
    expect(screen.getByText('+312 in ' + new Date().toLocaleString('en-GB', { month: 'short' }))).toBeInTheDocument();
    expect(screen.getByText('78% of buyers')).toBeInTheDocument();
    expect(screen.getByText('Blocked for refusing delivery').closest('.kpi')).toHaveTextContent('23');
    expect(await screen.findByRole('tab', { name: /^All/ })).toHaveTextContent('6,420');
    expect(screen.getByRole('tab', { name: /Repeat/ })).toHaveTextContent('1,440');
    expect(screen.getByRole('tab', { name: /First-time/ })).toHaveTextContent('4,980');
    expect(screen.getByRole('tab', { name: /Refused before/ })).toHaveTextContent('612');
    expect(screen.getByRole('tab', { name: /Not reachable/ })).toHaveTextContent('318');
  });

  it('the footer total is the list total, the same number as the All tab', async () => {
    renderPage();
    expect(await screen.findByText('Showing 25 of 6,420 customers')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveTextContent('6,420');
  });

  it('a tab click puts ?segment= in the URL and asks the API for it; page 1', async () => {
    renderPage('/customers?page=3');
    await userEvent.click(await screen.findByRole('tab', { name: /Refused before/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/customers?segment=refused_before');
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ segment: 'refused_before', page: 1 }), expect.anything()));
    // the tiles and tab counts are asked without a segment
    expect(getSummary).toHaveBeenLastCalledWith({}, expect.anything());
  });

  it('opens on the tab named in the URL', async () => {
    renderPage('/customers?segment=repeat');
    expect(await screen.findByRole('tab', { name: /Repeat/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Customers list: rows (F-350)', () => {
  it('shows phones in local format, state, counts, value, last order and the risk tags', async () => {
    renderPage();
    const yaw = (await screen.findByText('Yaw Boateng')).closest('tr') as HTMLElement;
    expect(within(yaw).getByText('024 555 0103')).toBeInTheDocument();
    expect(within(yaw).getByText('Ashanti')).toBeInTheDocument();
    expect(within(yaw).getByText('GH₵249')).toBeInTheDocument();
    expect(within(yaw).getByText('High')).toBeInTheDocument();
    expect(within(yaw).getByText('Not reachable')).toBeInTheDocument();
    const selorm = screen.getByText('Selorm Agbeko').closest('tr') as HTMLElement;
    expect(within(selorm).getByText('Blocked')).toBeInTheDocument();
    const abena = screen.getByText('Abena Owusu').closest('tr') as HTMLElement;
    expect(within(abena).getByText('Low')).toBeInTheDocument();
    expect(within(abena).getByText('17 Oct')).toBeInTheDocument();
    // no order yet: a dash in Last order
    const efua = screen.getByText('Efua Asante').closest('tr') as HTMLElement;
    expect(within(efua).getAllByText('—')).toHaveLength(1);
  });

  it('writes the risk rule under the table', async () => {
    renderPage();
    expect(await screen.findByText(/Low means no refusals, watch means 1, high means 2 or more\./)).toBeInTheDocument();
  });

  it('a row click opens the customer', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Yaw Boateng'));
    expect(screen.getByText('CUSTOMER PAGE')).toBeInTheDocument();
  });

  it('says "No customers match." for an empty list', async () => {
    answer([], 0);
    renderPage();
    expect(await screen.findByText('No customers match.')).toBeInTheDocument();
  });

  it('shows a Try again button when the list cannot load', async () => {
    listCustomers.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText('The customers could not load.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Customers list: search, filters, sort, paging (F-352, F-353)', () => {
  it('searches 300 ms after the last key press and keeps it in the URL; the clear button empties it', async () => {
    renderPage();
    await screen.findByText('Yaw Boateng');
    const box = screen.getByRole('textbox', { name: 'Search customers' });
    await userEvent.type(box, '0245550103');
    expect(listCustomers).not.toHaveBeenCalledWith(expect.objectContaining({ search: '0245550103' }), expect.anything());
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ search: '0245550103' }), expect.anything()), { timeout: SEARCH_DEBOUNCE_MS + 1500 });
    expect(screen.getByTestId('where')).toHaveTextContent('q=0245550103');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/customers'));
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('q='));
  });

  it('the City/Town filter lists the towns in use and sends area', async () => {
    renderPage();
    await screen.findByText('Yaw Boateng');
    const city = screen.getByRole('combobox', { name: 'City/Town' });
    await waitFor(() => expect(within(city).getByRole('option', { name: 'Tema' })).toBeInTheDocument());
    await userEvent.selectOptions(city, 'Tema');
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ area: 'Tema', page: 1 }), expect.anything()));
    expect(screen.getByTestId('where')).toHaveTextContent('town=Tema');
  });

  it('State, Risk, Blocked and Flagged send their filters, and the tiles get them too', async () => {
    renderPage();
    await screen.findByText('Yaw Boateng');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'Ashanti');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Risk' }), 'high');
    await userEvent.click(screen.getByRole('button', { name: 'Blocked' }));
    await userEvent.click(screen.getByRole('button', { name: /Flagged by agent/ }));
    await waitFor(() =>
      expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ region: 'Ashanti', risk: 'high', blocked: true, flagged: true }), expect.anything()));
    expect(getSummary).toHaveBeenLastCalledWith({ region: 'Ashanti', risk: 'high', blocked: true, flagged: true }, expect.anything());
  });

  it('a header click sorts: Delivered value biggest first, a second click turns it round', async () => {
    renderPage();
    await screen.findByText('Yaw Boateng');
    await userEvent.click(screen.getByRole('button', { name: /Sort by delivered value/ }));
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'deliveredValue', sortOrder: 'desc' }), expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: /Sort by delivered value/ }));
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'deliveredValue', sortOrder: 'asc' }), expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: /Sort by customer/ }));
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ sortBy: 'customer', sortOrder: 'asc' }), expect.anything()));
  });

  it('page sizes are 25, 50 and 100, default 25, and a change goes to the URL', async () => {
    renderPage();
    await screen.findByText('Yaw Boateng');
    const size = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(size).toHaveValue('25');
    expect(within(size).getAllByRole('option').map((o) => o.textContent)).toEqual(['25 per page', '50 per page', '100 per page']);
    expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 25 }), expect.anything());
    await userEvent.selectOptions(size, '50');
    await waitFor(() => expect(listCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50 }), expect.anything()));
    expect(screen.getByTestId('where')).toHaveTextContent('size=50');
  });
});

describe('Customers list: export and permissions (F-361)', () => {
  it('Export CSV sends the current filters', async () => {
    exportCustomers.mockResolvedValue(undefined);
    renderPage('/customers?risk=high&town=Kumasi');
    await userEvent.click(await screen.findByRole('button', { name: /Export CSV/ }));
    expect(exportCustomers).toHaveBeenCalledWith({ risk: 'high', area: 'Kumasi' });
    expect(await screen.findByText('Customers exported')).toBeInTheDocument();
  });

  it('a rep sees Add customer but not Export', async () => {
    useAuthStore.setState({ user: { id: 9, role: 'sales_rep' } as never, permissions: { customers: ['view', 'create', 'update'] } });
    renderPage();
    await screen.findByText('Yaw Boateng');
    expect(screen.getByRole('button', { name: /Add customer/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });
});

describe('Add customer (F-355)', () => {
  const open = async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Add customer/ }));
    return screen.getByRole('dialog', { name: 'Add customer' });
  };

  it('has every field of the form', async () => {
    const dlg = await open();
    ['First name', 'Last name', 'Phone', 'Alternate phone', 'Email', 'State', 'City/Town', 'Street address', 'Nearest landmark', 'Internal notes'].forEach((label) =>
      expect(within(dlg).getByLabelText(new RegExp(`^${label}`))).toBeInTheDocument());
  });

  it('requires first name, phone, state, city/town and address; letters in a phone are an error', async () => {
    const dlg = await open();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add customer' }));
    expect(within(dlg).getByText('First name is required')).toBeInTheDocument();
    expect(within(dlg).getByText('Phone needs at least 9 digits')).toBeInTheDocument();
    expect(within(dlg).getByText('State is required')).toBeInTheDocument();
    expect(within(dlg).getByText('City/Town is required')).toBeInTheDocument();
    expect(within(dlg).getByText('Address is required')).toBeInTheDocument();
    expect(createCustomer).not.toHaveBeenCalled();
    await userEvent.type(within(dlg).getByLabelText('Phone'), '024abc5550100');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add customer' }));
    expect(within(dlg).getByText('Phone can only have digits, spaces, + and dashes')).toBeInTheDocument();
  });

  const fill = async (dlg: HTMLElement) => {
    await userEvent.type(within(dlg).getByLabelText('First name'), 'Abena');
    await userEvent.type(within(dlg).getByLabelText(/^Last name/), 'Owusu');
    await userEvent.type(within(dlg).getByLabelText('Phone'), '024 555 0100');
    await userEvent.selectOptions(within(dlg).getByLabelText('State'), 'Ashanti');
    await within(dlg).findByRole('option', { name: 'Kumasi' });
    await userEvent.selectOptions(within(dlg).getByLabelText('City/Town'), 'Kumasi');
    await userEvent.type(within(dlg).getByLabelText('Street address'), '12 Ring Road');
  };

  it('saves, closes, says so and reloads the list', async () => {
    createCustomer.mockResolvedValue({ id: 77 });
    const dlg = await open();
    await fill(dlg);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add customer' }));
    await waitFor(() => expect(createCustomer).toHaveBeenCalled());
    expect(createCustomer.mock.calls[0][0]).toMatchObject({ firstName: 'Abena', lastName: 'Owusu', phoneNumber: '024 555 0100', state: 'Ashanti', area: 'Kumasi', address: '12 Ring Road' });
    expect(await screen.findByText('Abena Owusu added')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(listCustomers.mock.calls.length).toBeGreaterThan(1));
  });

  it('a phone that exists shows who has it, with a link, and the form stays open', async () => {
    createCustomer.mockRejectedValue(Object.assign(new Error('409'), {
      isAxiosError: true,
      response: { status: 409, data: { code: 'PHONE_BELONGS_TO_OTHER_CUSTOMER', message: 'This number belongs to Abena Owusu', customerId: 5, customerName: 'Abena Owusu' } },
    }));
    const dlg = await open();
    await fill(dlg);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add customer' }));
    expect(await within(dlg).findByText('This number belongs to Abena Owusu')).toBeInTheDocument();
    expect(within(dlg).getByRole('link', { name: 'Open Abena Owusu' })).toHaveAttribute('href', '/customers/5');
  });

  it('a deleted customer with the phone offers Reactivate to an owner, admin or manager only', async () => {
    const archived = Object.assign(new Error('409'), {
      isAxiosError: true,
      response: { status: 409, data: { code: 'CUSTOMER_ARCHIVED', message: 'Abena Owusu was deleted and has this number. Restore that customer instead.', customerId: 5, customerName: 'Abena Owusu' } },
    });
    createCustomer.mockRejectedValueOnce(archived).mockResolvedValueOnce({ id: 5 });
    const dlg = await open();
    await fill(dlg);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add customer' }));
    await userEvent.click(await within(dlg).findByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(createCustomer).toHaveBeenLastCalledWith(expect.objectContaining({ reactivate: true })));
  });

  it('a rep gets the message but no Reactivate button', async () => {
    useAuthStore.setState({ user: { id: 9, role: 'sales_rep' } as never, permissions: { customers: ['view', 'create', 'update'] } });
    createCustomer.mockRejectedValue(Object.assign(new Error('409'), {
      isAxiosError: true,
      response: { status: 409, data: { code: 'CUSTOMER_ARCHIVED', message: 'Abena Owusu was deleted and has this number. Restore that customer instead.', customerName: 'Abena Owusu' } },
    }));
    const dlg = await open();
    await fill(dlg);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Add customer' }));
    expect(await within(dlg).findByText(/was deleted and has this number/)).toBeInTheDocument();
    expect(within(dlg).queryByRole('button', { name: 'Reactivate' })).toBeNull();
    expect(within(dlg).queryByRole('link')).toBeNull();
  });
});
