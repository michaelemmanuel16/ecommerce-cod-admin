import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Deliveries } from '../../pages/Deliveries';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { LIST, PARTNERS, REASONS, SUMMARY, WAITING } from '../fixtures/deliveriesList';

const list = vi.fn();
const summary = vi.fn();
const failureReasons = vi.fn();
const waiting = vi.fn();
vi.mock('../../services/delivery-partners.service', async (orig) => ({
  ...(await orig<typeof import('../../services/delivery-partners.service')>()),
  deliveryPartnersService: {
    list: (...a: unknown[]) => list(...a),
    summary: (...a: unknown[]) => summary(...a),
    failureReasons: (...a: unknown[]) => failureReasons(...a),
    waiting: (...a: unknown[]) => waiting(...a),
  },
}));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderPage(url = '/delivery-agents') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/delivery-agents" element={<Deliveries />} />
          <Route path="/orders" element={<div>ORDERS PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  [list, summary, failureReasons, waiting].forEach((m) => m.mockReset());
  list.mockImplementation((_range: unknown, type: string) =>
    Promise.resolve({ ...LIST, type, rows: type === 'all' ? PARTNERS : PARTNERS.filter((p) => p.type === type) }));
  summary.mockResolvedValue(SUMMARY);
  failureReasons.mockResolvedValue(REASONS);
  waiting.mockResolvedValue(WAITING);
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A' } as never, permissions: {} });
});

describe('Deliveries page (M4-T30)', () => {
  it('shows the five tiles from the summary', async () => {
    renderPage();
    const tile = async (label: string) => (await screen.findByText(label)).closest('.kpi') as HTMLElement;
    expect(await tile('Out for delivery now')).toHaveTextContent('148');
    expect(await tile('Waiting to dispatch')).toHaveTextContent('100');
    expect(await tile('Delivered this month')).toHaveTextContent('376');
    expect(screen.getByText('12 pts under')).toBeInTheDocument();
    expect(screen.getByText('Cash still with agents and 3PLs')).toBeInTheDocument();
  });

  it('draws the table with a total row and the tab counts', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Delivery partners' });
    expect(within(table).getByText('Logiswift')).toBeInTheDocument();
    expect(within(table).getByText('GH₵35 · GH₵0 · GH₵0')).toBeInTheDocument();
    expect(within(table).getAllByText('No fee rule')).toHaveLength(2);
    expect(within(table).getByText('No closed orders yet')).toBeInTheDocument();
    expect(within(table).getByText('Unavailable')).toBeInTheDocument();
    const total = within(table).getByText('All partners').closest('tr')!;
    ['926', '376', '402', '148', '48%'].forEach((v) => expect(within(total).getByText(v)).toBeInTheDocument());
    expect(within(screen.getByRole('tab', { name: /All partners/ })).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /Agents/ })).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByRole('tab', { name: /3PLs/ })).getByText('2')).toBeInTheDocument();
  });

  it('a tab asks the API for that type and keeps it in the URL', async () => {
    renderPage();
    await screen.findByRole('table', { name: 'Delivery partners' });
    await userEvent.click(screen.getByRole('tab', { name: /3PLs/ }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.anything(), '3pl', expect.anything()));
    expect(screen.getByTestId('where')).toHaveTextContent('tab=3pl');
    const table = await screen.findByRole('table', { name: 'Delivery partners' });
    await waitFor(() => expect(within(table).queryByText('Kofi Appiah')).not.toBeInTheDocument());
  });

  it('shows a retry when the table cannot load', async () => {
    list.mockRejectedValue(new Error('x'));
    renderPage();
    expect(await screen.findByText('The delivery partners could not load.')).toBeInTheDocument();
  });
});
