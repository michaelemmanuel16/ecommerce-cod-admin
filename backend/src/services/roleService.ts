import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

/** The Owner role (built from `super_admin`) can never be deleted (F-1150). */
export function assertRoleDeletable(role: { name: string; presetRole: string | null }): void {
  if (role.presetRole === 'super_admin' || role.name === 'Owner') throw new AppError('The Owner role cannot be deleted', 400);
}

/** Delete a role of the current tenant. M6-T03 adds the holder check ("Move N holders first") and the route. */
export async function deleteRole(roleId: number): Promise<void> {
  const role = await prisma.role.findFirst({ where: { id: roleId }, select: { id: true, name: true, presetRole: true } });
  if (!role) throw new AppError('Role not found', 404);
  assertRoleDeletable(role);
  await prisma.role.delete({ where: { id: role.id } });
}
