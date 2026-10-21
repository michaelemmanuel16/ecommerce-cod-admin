import { prismaBase } from '../../../utils/prisma';
import { generateAccessToken } from '../../../utils/jwt';

/** A new super_admin user in the tenant, as an access token. `emailPrefix` keeps the email unique across test files. */
export async function superAdminToken(tenantId: string, slug: string, emailPrefix = 'owner') {
  const u = await prismaBase.user.create({
    data: { email: `${emailPrefix}-${slug}@codadmin.test`, password: 'x', firstName: 'Owner', lastName: slug, role: 'super_admin', tenantId },
  });
  return generateAccessToken({ id: u.id, email: u.email, role: 'super_admin', tenantId });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
