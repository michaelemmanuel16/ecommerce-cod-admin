/**
 * The only place that builds Socket.io room names. Every tenant room starts with
 * `t:<tenantId>:`, so an emit to one tenant can never reach another tenant's
 * sockets. Platform admins have no tenant and only join the `platform` rooms.
 */
export const roomNames = {
  tenant: (tenantId: string) => `t:${tenantId}`,
  role: (tenantId: string, role: string) => `t:${tenantId}:role:${role}`,
  user: (tenantId: string, userId: number | string) => `t:${tenantId}:user:${userId}`,
  order: (tenantId: string, orderId: number | string) => `t:${tenantId}:order:${orderId}`,
  platform: 'platform',
  platformUser: (userId: number | string) => `platform:user:${userId}`,
};
