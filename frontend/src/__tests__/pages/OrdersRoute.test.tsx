import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { OrdersRoute } from '../../pages/orders/OrdersRoute';

// The list and the drawer are covered in their own tests; here only the wiring of the route is checked.
vi.mock('../../pages/Orders', () => ({
  Orders: ({ onOpen }: { onOpen: (id: number) => void }) => <button onClick={() => onOpen(24118)}>open order</button>,
}));
vi.mock('../../pages/orders/drawer/OrderDrawer', () => ({
  OrderDrawer: ({ id, onClose }: { id: number | null; onClose: () => void }) => (
    <div>
      <span data-testid="drawer-id">{String(id)}</span>
      <button onClick={onClose}>close drawer</button>
    </div>
  ),
}));

function Where() {
  const { pathname, search } = useLocation();
  return <span data-testid="where">{pathname + search}</span>;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/orders/:id?" element={<><OrdersRoute /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OrdersRoute (F-321)', () => {
  it('/orders keeps the drawer closed', () => {
    renderAt('/orders');
    expect(screen.getByTestId('drawer-id')).toHaveTextContent('null');
  });

  it('/orders/24118 passes the number to the drawer', () => {
    renderAt('/orders/24118');
    expect(screen.getByTestId('drawer-id')).toHaveTextContent('24118');
  });

  it('a non-numeric id does not open the drawer', () => {
    renderAt('/orders/abc');
    expect(screen.getByTestId('drawer-id')).toHaveTextContent('null');
  });

  it('opening a row and closing the drawer keep the filters in the URL', async () => {
    renderAt('/orders?tab=pending&page=3');
    await userEvent.click(screen.getByText('open order'));
    expect(screen.getByTestId('where')).toHaveTextContent('/orders/24118?tab=pending&page=3');
    await userEvent.click(screen.getByText('close drawer'));
    expect(screen.getByTestId('where')).toHaveTextContent('/orders?tab=pending&page=3');
  });
});
