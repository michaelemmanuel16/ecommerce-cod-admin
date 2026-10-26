import { FindingStatus, FindingType } from '@prisma/client';
import { z } from 'zod';

/** The statuses a person can move an open Finding to. `closed` is for the system (a settlement cleared the cause). */
export const RESOLVE_STATUSES = ['explained', 'written_off'] as const;
export type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

const positiveInt = z.coerce.number().int().positive();

/** GET /api/findings query. assigneeId=none lists the unassigned. */
export const findingListQuerySchema = z.object({
  type: z.enum(Object.values(FindingType) as [FindingType, ...FindingType[]], { message: 'Unknown Finding type' }).optional(),
  status: z.enum(Object.values(FindingStatus) as [FindingStatus, ...FindingStatus[]], { message: 'Unknown Finding status' }).optional(),
  assigneeId: z.union([z.literal('none'), positiveInt]).optional(),
  page: positiveInt.default(1),
  limit: positiveInt.max(100).default(25),
});

/** PATCH /api/findings/:id body. */
export const findingPatchSchema = z.object({
  assigneeId: z.number().int().positive().nullable().optional(),
  status: z.enum(RESOLVE_STATUSES, { message: 'Status must be explained or written_off' }).optional(),
  explanation: z.string().optional(),
});
