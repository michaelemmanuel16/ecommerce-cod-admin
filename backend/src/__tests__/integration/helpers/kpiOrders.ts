import { prismaBase } from '../../../utils/prisma';
import type { OrderStatus, PaymentStatus } from '@prisma/client';

/** Small order builders for the KPI integration tests (COD-11). Rows go in through the un-extended client with an explicit tenantId. */

let seq = 0;

export async function makeCustomer(tenantId: string) {
  seq += 1;
  return prismaBase.customer.create({
    data: {
      firstName: 'Kofi', lastName: 'Owusu',
      phoneNumber: `+2335${String(Date.now()).slice(-6)}${seq}`.slice(0, 15),
      address: '2 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId,
    },
  });
}

export interface KpiOrderInput {
  tenantId: string;
  customerId: number;
  status: OrderStatus;
  totalAmount?: number;
  paymentStatus?: PaymentStatus;
  createdAt?: Date;
  updatedAt?: Date;
  deliveryDate?: Date | null;
  returnedAt?: Date | null;
  deliveryAgentId?: number | null;
  customerRepId?: number | null;
  confirmedById?: number | null;
  /** History rows to write: status and when. */
  history?: Array<{ status: OrderStatus; at: Date }>;
}

export async function makeOrder(i: KpiOrderInput) {
  const total = i.totalAmount ?? 100;
  const order = await prismaBase.order.create({
    data: {
      customerId: i.customerId, status: i.status, paymentStatus: i.paymentStatus ?? 'pending',
      subtotal: total, shippingCost: 0, totalAmount: total,
      deliveryAddress: '2 Test Rd', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      tenantId: i.tenantId,
      ...(i.createdAt ? { createdAt: i.createdAt } : {}),
      ...(i.updatedAt ? { updatedAt: i.updatedAt } : {}),
      ...(i.deliveryDate !== undefined ? { deliveryDate: i.deliveryDate } : {}),
      ...(i.returnedAt !== undefined ? { returnedAt: i.returnedAt } : {}),
      ...(i.deliveryAgentId !== undefined ? { deliveryAgentId: i.deliveryAgentId } : {}),
      ...(i.customerRepId !== undefined ? { customerRepId: i.customerRepId } : {}),
      ...(i.confirmedById !== undefined ? { confirmedById: i.confirmedById } : {}),
    },
  });
  if (i.history?.length) {
    await prismaBase.orderHistory.createMany({
      data: i.history.map((h) => ({ orderId: order.id, status: h.status, createdAt: h.at, tenantId: i.tenantId })),
    });
  }
  return order;
}

export function makeUser(tenantId: string, label: string, role: string) {
  seq += 1;
  return prismaBase.user.create({
    data: { email: `kpi-${label}-${Date.now()}-${seq}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role: role as any, tenantId },
  });
}
