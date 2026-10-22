import { useEffect, useState } from 'react';
import { customerRepsService } from '../../services/customer-reps.service';
import { deliveryAgentsService } from '../../services/delivery-agents.service';
import { productsService } from '../../services/products.service';

export interface Option {
  id: number;
  name: string;
  /** Delivery agents only: the person is marked unavailable today. */
  unavailable?: boolean;
}

interface Options {
  products: Option[];
  agents: Option[];
  reps: Option[];
}

const EMPTY: Options = { products: [], agents: [], reps: [] };

/**
 * The choices of the Product, Delivery agent and Assigned to filters, and of the Assign menus. Each list loads on its
 * own; one that the person may not read (a 403) is left empty and its filter is not drawn.
 */
export function useFilterOptions(): Options {
  const [options, setOptions] = useState<Options>(EMPTY);
  useEffect(() => {
    let live = true;
    const put = (patch: Partial<Options>) => live && setOptions((o) => ({ ...o, ...patch }));
    const num = (id: string | number) => Number(id);
    productsService.getProducts()
      .then((ps) => put({ products: ps.filter((p) => p.isActive !== false).map((p) => ({ id: p.id, name: p.name })) }))
      .catch(() => undefined);
    deliveryAgentsService.getDeliveryAgents()
      .then((as) => put({ agents: as.filter((a) => a.isActive).map((a) => ({ id: num(a.id), name: a.name, unavailable: a.isAvailable === false })) }))
      .catch(() => undefined);
    customerRepsService.getCustomerReps()
      .then((rs) => put({ reps: rs.filter((r) => r.isActive).map((r) => ({ id: num(r.id), name: r.name })) }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return options;
}
