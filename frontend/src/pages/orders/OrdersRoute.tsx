import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Orders } from '../Orders';
import { OrderDrawer } from './drawer/OrderDrawer';

/**
 * /orders and /orders/:id (F-321). The list stays mounted behind the drawer, so its filters, page and scroll survive
 * opening and closing. The query string (tab, filters, page) travels with the URL in both directions.
 */
export function OrdersRoute() {
  const { id } = useParams<{ id?: string }>();
  const { search } = useLocation();
  const navigate = useNavigate();
  const orderId = id && /^\d+$/.test(id) ? Number(id) : null;
  return (
    <>
      <Orders onOpen={(open) => navigate(`/orders/${open}${search}`)} />
      <OrderDrawer id={orderId} onClose={() => navigate(`/orders${search}`)} />
    </>
  );
}
