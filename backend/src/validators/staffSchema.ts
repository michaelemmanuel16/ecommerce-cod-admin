import { z } from 'zod';
import { UserRole } from '@prisma/client';

/** Input of the staff routes (M6-T05, F-1157 to F-1165) and of `adminService.updateUser`. */

const text = (max: number) => z.string().trim().max(max);

export const STAFF_STATUSES = ['active', 'invited', 'deactivated', 'deleted'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

const userRole = z.nativeEnum(UserRole);

export const staffQuerySchema = z.object({
  status: z.enum(STAFF_STATUSES).optional(),
  /** A UserRole name, or the id of a Role (position role) the person holds now. */
  role: z.union([userRole, z.string().regex(/^\d+$/, 'Role must be a role name or a role id')]).optional(),
  q: text(100).optional(),
});

/** The fields of a person an admin may change. One list for the staff edit and for `updateUser`. */
const personFields = {
  firstName: text(100).min(1, 'First name is required'),
  lastName: text(100).min(1, 'Last name is required'),
  email: z.string().trim().toLowerCase().email('Email is not valid').max(254),
  role: userRole,
  /** Per delivery, for a call rep. Applies to deliveries after the change. Not for delivery partners: their fee is a fee rule (M5). */
  commissionAmount: z.number().min(0).max(1_000_000),
  vehicleType: text(50),
  vehicleId: text(50),
};

export const updateStaffSchema = z.object({ ...personFields, phoneNumber: text(30) }).partial().strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/**
 * What `adminService.updateUser` takes from the old admin and user routes: the whitelist. Anything else in the body
 * (tenantId, password, kind, invitedAt, deletedAt, id, ...) is dropped before it reaches the database. These routes send
 * whole forms, so unknown keys are stripped, not refused.
 */
export const updateUserSchema = z.object({
  ...personFields,
  /** "First Last" in one field; the first word is the first name. */
  name: text(200).min(1),
  phoneNumber: text(30).nullish(),
  country: text(60).nullish(),
  isActive: z.boolean(),
  // Old forms may send a number as text.
  commissionAmount: z.coerce.number().min(0).max(1_000_000),
}).partial();

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
}).strict();

/** Permanent delete: the person's email, typed. Compared in the service (case-insensitive). */
export const permanentDeleteSchema = z.object({ confirm: z.string().trim().min(1, "Type the person's email to confirm") }).strict();
