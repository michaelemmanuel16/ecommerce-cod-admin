import { UserRole } from '@prisma/client';

export interface Requester {
    id: number;
    role: UserRole;
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
    if (requester.role === 'super_admin' || requester.role === 'admin' || requester.role === 'manager') {
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
