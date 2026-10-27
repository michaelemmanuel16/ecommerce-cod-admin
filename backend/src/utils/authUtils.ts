import { Prisma, UserRole } from '@prisma/client';

export interface Requester {
    id: number;
    role: UserRole;
}

/** Owner, admin and manager: the roles that see and manage every row. */
export const isManagerUp = (requester: { role: UserRole | string }): boolean =>
    requester.role === 'super_admin' || requester.role === 'admin' || requester.role === 'manager';

/** The owner: the one role that may do the owner-only things (a write-off). */
export const isOwner = (requester: { role: UserRole | string }): boolean => requester.role === 'super_admin';

/** Order row scope: a rep sees orders where they are the call rep, a delivery agent their own deliveries. Other roles see all. */
export function orderScope(requester?: Requester): Prisma.OrderWhereInput {
    if (requester?.role === 'sales_rep') return { customerRepId: requester.id };
    if (requester?.role === 'delivery_agent') return { deliveryAgentId: requester.id };
    return {};
}

/**
 * Customer row scope (F-350): owner, admin and manager see all, and so do accountant and inventory manager (like orderScope).
 * A call rep sees customers they created or have an order with; a delivery agent sees customers of their own deliveries.
 * Returns null when the requester is unscoped.
 */
export function customerScope(requester?: Requester): Prisma.CustomerWhereInput | null {
    if (!requester) return null;
    const { id, role } = requester;
    if (role === 'sales_rep') {
        return { OR: [{ createdById: id }, { orders: { some: { customerRepId: id, deletedAt: null } } }] };
    }
    if (role === 'delivery_agent') return { orders: { some: { deliveryAgentId: id, deletedAt: null } } };
    return null;
}

/**
 * Checks if a user has ownership or assignment of a specific resource.
 * Admin roles bypass these checks.
 */
export const checkResourceOwnership = (
    requester: Requester,
    resource: any,
    resourceType: 'order' | 'customer' | 'user' | 'expense' | 'transaction' | 'financial'
): boolean => {
    // Super Admins, Admins, and Managers bypass ownership checks
    if (isManagerUp(requester)) {
        return true;
    }

    switch (resourceType) {
        case 'order':
            // For orders, we check if the requester is the rep or the delivery agent
            return resource.assignedRepId === requester.id || resource.deliveryAgentId === requester.id;

        case 'customer':
            // For customers, ownership is determined by transaction history
            // Specific service methods handle this DB-intensive check
            return false;

        case 'expense':
            // For expenses, we check if the requester is the one who recorded it
            return resource.recordedBy === requester.id;

        case 'transaction':
            // For transactions, we check if the associated order belongs to the requester
            if (resource.order) {
                return (
                    resource.order.customerRepId === requester.id ||
                    resource.order.deliveryAgentId === requester.id
                );
            }
            return false;

        case 'financial':
            // Generic financial resource check - usually requires higher roles
            // Specific methods will handle fine-grained filtering
            return false;

        case 'user':
            // For user profiles, users can only see their own profile
            return resource.id === requester.id;

        default:
            return false;
    }
};

/**
 * Role hierarchy weights to prevent privilege escalation.
 */
export const getRoleWeight = (role: UserRole): number => {
    switch (role) {
        case 'super_admin': return 100;
        case 'admin': return 80;
        case 'manager': return 60;
        case 'inventory_manager': return 40;
        case 'sales_rep': return 20;
        case 'delivery_agent': return 10;
        case 'accountant': return 10;
        default: return 0;
    }
};

/**
 * Checks if a requester can manage (create/update/delete) a user with a specific role.
 * Rule: Requester must have a higher role than the target, or be a super_admin.
 */
export const canManageRole = (requesterRole: UserRole, targetRole: UserRole): boolean => {
    if (requesterRole === 'super_admin') return true;
    const requesterWeight = getRoleWeight(requesterRole);
    const targetWeight = getRoleWeight(targetRole);
    return requesterWeight > targetWeight;
};
