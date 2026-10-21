import { EventEmitter } from 'events';
import { ActorKind, OrderStatus } from '@prisma/client';
import logger from './logger';
import { resolveTenantId } from './tenantContext';

class AppEvents extends EventEmitter { }

const appEvents = new AppEvents();

export enum AppEvent {
    AGENT_COLLECTION_RECONCILED = 'AGENT_COLLECTION_RECONCILED',
    BULK_ORDERS_IMPORTED = 'BULK_ORDERS_IMPORTED',
    ORDERS_DELETED = 'ORDERS_DELETED',
    ORDER_CREATED = 'order.created',
    ORDER_STATUS_CHANGED = 'order.status_changed',
    ORDER_DELETED = 'order.deleted',
    // Add more as needed
}

/** Fields both order events carry. `runWorkflows: true` overrides the skip rules for imports and integrations. */
interface OrderEventBase {
    orderId: number;
    tenantId: string;
    /** The order came in through a bulk or sheet import. */
    imported?: boolean;
    runWorkflows?: boolean;
}

export interface OrderCreatedEvent extends OrderEventBase {
    status: OrderStatus;
}

export interface OrderStatusChangedEvent extends OrderEventBase {
    from: OrderStatus;
    to: OrderStatus;
    actor: { kind: ActorKind; userId?: number };
    /** Workflow-caused moves in a row that led here; 0 for a person or an integration (loop guard). */
    depth: number;
    /** The order's delivery date after the move. */
    deliveryDate?: Date | null;
}

/** A soft-deleted order. It carries the customer because the listener cannot count a deleted order back to its customer. */
export interface OrderDeletedEvent extends OrderEventBase {
    customerId: number;
}

interface OrderEventMap {
    [AppEvent.ORDER_CREATED]: OrderCreatedEvent;
    [AppEvent.ORDER_STATUS_CHANGED]: OrderStatusChangedEvent;
    [AppEvent.ORDER_DELETED]: OrderDeletedEvent;
}

/**
 * Emit an order event. Call it after the transaction commits. A throwing listener never reaches the
 * caller: the status change or the order is already saved.
 */
export function emitOrderEvent<E extends keyof OrderEventMap>(event: E, payload: OrderEventMap[E]): void {
    try {
        appEvents.emit(event, payload);
    } catch (error: any) {
        logger.error('Order event listener failed', { event, orderId: payload.orderId, error: error?.message });
    }
}

/**
 * Emit `order.created` for a saved order (not the socket `emitOrderCreated`). Imported orders pass
 * `imported`; `runWorkflows` overrides the import skip rule.
 */
export function emitOrderCreatedEvent(
    order: { id: number; tenantId?: string | null; status: OrderStatus },
    opts: { imported?: boolean; runWorkflows?: boolean } = {},
): void {
    emitOrderEvent(AppEvent.ORDER_CREATED, {
        orderId: order.id, tenantId: resolveTenantId(order.tenantId), status: order.status, ...opts,
    });
}

/** Emit `order.deleted` for a soft-deleted order, after the transaction commits. */
export function emitOrderDeletedEvent(order: { id: number; tenantId?: string | null; customerId: number }): void {
    emitOrderEvent(AppEvent.ORDER_DELETED, {
        orderId: order.id, tenantId: resolveTenantId(order.tenantId), customerId: order.customerId,
    });
}

export function onOrderEvent<E extends keyof OrderEventMap>(event: E, listener: (payload: OrderEventMap[E]) => void): void {
    appEvents.on(event, listener);
}

export default appEvents;
