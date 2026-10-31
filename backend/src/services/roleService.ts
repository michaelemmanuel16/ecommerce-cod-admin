import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { isOwnerRole } from '../config/defaultRoles';

/** Delete a role of the current tenant. M6-T03 adds the holder check ("Move N holders first") and the route. */
export async function deleteRole(roleId: number): Promise<void> {
  const role = await prisma.role.findFirst({ where: { id: roleId }, select: { id: true, presetRole: true } });
  if (!role) throw new AppError('Role not found', 404);
  if (isOwnerRole(role)) throw new AppError('The Owner role cannot be deleted', 400);
  await prisma.role.delete({ where: { id: role.id } });
}
