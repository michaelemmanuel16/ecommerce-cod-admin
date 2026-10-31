import { z } from 'zod';

/** Input of the staff routes (M6-T05, F-1157 to F-1165). Strict: an unknown field is refused. */

const text = (max: number) => z.string().trim().max(max);

export const STAFF_STATUSES = ['active', 'invited', 'deactivated', 'deleted'] as const;

export const USER_ROLES = ['super_admin', 'admin', 'manager', 'inventory_manager', 'sales_rep', 'delivery_agent', 'accountant'] as const;

export const staffQuerySchema = z.object({
  status: z.enum(STAFF_STATUSES).optional(),
  /** A UserRole name, or the id of a Role (position role) the person holds now. */
  role: z.union([z.enum(USER_ROLES), z.string().regex(/^\d+$/, 'Role must be a role name or a role id')]).optional(),
  q: text(100).optional(),
});

export const updateStaffSchema = z.object({
  firstName: text(100).min(1, 'First name is required'),
  lastName: text(100).min(1, 'Last name is required'),
  email: z.string().trim().toLowerCase().email('Email is not valid').max(254),
  phoneNumber: text(30),
  role: z.enum(USER_ROLES),
  /** Per delivery, for a call rep. Applies to deliveries after the change. Not for delivery partners: their fee is a fee rule (M5). */
  commissionAmount: z.number().min(0).max(1_000_000),
  vehicleType: text(50),
  vehicleId: text(50),
}).partial().strict().refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
}).strict();

/** The word to type before a permanent delete. */
export const DELETE_CONFIRM_TOKEN = 'DELETE';

export const permanentDeleteSchema = z.object({
  confirm: z.literal(DELETE_CONFIRM_TOKEN, { message: `Type ${DELETE_CONFIRM_TOKEN} to confirm` }),
}).strict();
