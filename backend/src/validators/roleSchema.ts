import { z } from 'zod';

/** Input of the role routes (M6-T03, F-1150, F-1152, F-1156). Strict: an unknown field (tools, permissions) is refused; those are M6-T04. */

/** Every UserRole a role can give its holders; the Owner's super_admin is not one of them. */
const BASE_ROLES = ['admin', 'manager', 'sales_rep', 'inventory_manager', 'delivery_agent', 'accountant'] as const;

const text = (max: number) => z.string().trim().max(max);

const contract = z.object({
  purpose: text(500).optional(),
  results: text(2000).optional(),
  accountabilities: text(2000).optional(),
  standards: text(2000).optional(),
}).strict();

const roleFields = {
  name: text(60).min(1, 'Name is required'),
  area: text(60).nullish(),
  contract: contract.optional(),
  kpis: z.array(text(80).min(1)).max(20).optional(),
  targetMetric: text(60).nullish(),
  /** The base role (UserRole) of the people and companies assigned to this role. Owner only; never super_admin. Default: manager. */
  presetRole: z.enum(BASE_ROLES).optional(),
};

export const createRoleSchema = z.object({
  ...roleFields,
  /** Start from the tools of an existing role of the tenant (F-1156). Without it the role has no tools. */
  copyToolsFromRoleId: z.number().int().positive().optional(),
}).strict();

export const updateRoleSchema = z.object(roleFields).partial().strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** M6-T04: the tool switches (registry tool names) and the permission matrix (resource -> actions) of a role. Names are checked in the service. */
export const setToolsSchema = z.object({ tools: z.array(text(60).min(1)).max(50) }).strict();

export const setPermissionsSchema = z.object({
  permissions: z.record(text(40).min(1), z.array(text(40).min(1)).max(20)),
}).strict();

const email = z.string().trim().toLowerCase().email('Email is not valid').max(254);
const phone = text(30).optional();
const name = text(100).min(1, 'Name is required');

export const assignSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('existing'), holderId: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('person'), name, email, phoneNumber: phone }).strict(),
  z.object({
    type: z.literal('ai_agent'),
    name,
    /** Reuse an AI agent user of the tenant instead of making one. */
    userId: z.number().int().positive().optional(),
    expiresInDays: z.number().int().min(1).max(365).optional(),
  }).strict(),
  z.object({ type: z.literal('company'), name, email: email.optional(), phoneNumber: phone }).strict(),
]);

export type AssignInput = z.infer<typeof assignSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
