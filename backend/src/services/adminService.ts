import { getPaymentProvider, clearPaymentConfigCache } from './payments';
import { saveConnection } from './paymentConnectionService';
import { parseFeaturePatch, clearTenantFeaturesCache } from './tenantFeatures';
import prisma, { TransactionClient } from '../utils/prisma';
import { sessionService } from './sessionService';
import { withSoftDeleted } from '../utils/prismaExtensions';
import bcrypt from 'bcrypt';
import { UserKind, UserRole } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import { Requester, canManageRole } from '../utils/authUtils';
import { clearWhatsAppConfigCache } from './whatsappService';
import {
  encryptProviderSecrets,
  decryptProviderSecrets,
  maskProviderSecrets,
  preserveMaskedSecrets,
  SENSITIVE_FIELDS,
  decryptString,
} from '../utils/providerCrypto';
import { getTenantId, resolveTenantId, withoutTenant } from '../utils/tenantContext';
import { HUMAN_USERS_WHERE } from './systemUserService';
import { formTenantBySlug } from './tenantLookupService';
import { clearCheckoutFormConfigCache } from './checkoutFormService';
import { currencyOfTenant, getCurrency } from '../utils/currency';
import { changeStoreCurrency } from './fxService';
import { parseOperatingHours } from './kpi/workingTime';
import { normalizeInternationalPhone } from '../utils/phone';
import { isValidTimeZone } from '../utils/timeZone';

export const adminService = {
  /**
   * Internal helper to verify admin privileges.
   */
  async checkAdminPrivilege(requester: Requester, minRole: UserRole = 'admin') {
    if (requester.role === 'super_admin') return;

    const requesterWeight = this.getRoleWeight(requester.role);
    const minWeight = this.getRoleWeight(minRole);

    if (requesterWeight < minWeight) {
      throw new AppError(`Access denied: Requires ${minRole} or higher.`, 403);
    }
  },

  getRoleWeight(role: UserRole): number {
    const weights: Record<UserRole, number> = {
      super_admin: 100,
      admin: 80,
      manager: 60,
      inventory_manager: 40,
      sales_rep: 20,
      delivery_agent: 10,
      accountant: 10
    };
    return weights[role] || 0;
  },

  /**
   * Internal helper to create audit logs
   */
  async createAuditLog(
    requester: Requester,
    action: string,
    resource: string,
    resourceId?: string,
    metadata?: any
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: resolveTenantId(),
          userId: requester.id,
          action,
          resource,
          resourceId: resourceId?.toString(),
          metadata: metadata || {},
        }
      });
    } catch (error: any) {
      logger.error('Failed to create audit log', {
        error: error.message,
        userId: requester.id,
        action,
        resource
      });
      // Don't throw error to avoid blocking the main transaction
    }
  },

  // System Config
  async getSystemConfig(requester?: Requester) {
    if (requester) {
      await this.checkAdminPrivilege(requester, 'admin');
    }

    const tenantId = getTenantId();

    // Per-tenant SystemConfig: scope by the request's tenant. Falls back to
    // global (null tenant) for legacy single-tenant deployments.
    // include-load the tenant relation so we get slug in the same round-trip.
    let config: any = tenantId
      ? await prisma.systemConfig.findUnique({
          where: { tenantId },
          include: { tenant: { select: { slug: true } } },
        })
      : await prisma.systemConfig.findFirst({
          where: { tenantId: null },
          include: { tenant: { select: { slug: true } } },
        });

    let tenantSlug: string | null = config?.tenant?.slug ?? null;

    if (!config) {
      // Seed from tenant data if available (business name, tenantId)
      let tenantDefaults: { businessName?: string } = {};
      if (tenantId) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, slug: true },
        });
        if (tenant) {
          tenantDefaults = {
            businessName: tenant.name,
          };
          tenantSlug = tenant.slug;
        }
      }

      config = await prisma.systemConfig.create({
        data: {
          businessName: tenantDefaults.businessName || null,
          rolePermissions: this.getDefaultPermissions(),
          tenantId: tenantId ?? null,
        },
      });
    }

    // Decrypt + mask every provider in one pass keyed off SENSITIVE_FIELDS so
    // adding a new integration is a one-line map update, not a copy-paste.
    const result: any = { ...config };
    delete result.tenant; // strip the include before sending
    for (const providerType of Object.keys(SENSITIVE_FIELDS)) {
      const raw = result[providerType];
      if (!raw) continue;
      const decrypted = decryptProviderSecrets(providerType, raw);
      result[providerType] = maskProviderSecrets(providerType, decrypted);
    }

    // tenantSlug travels with the config so the admin UI can render the
    // per-tenant Paystack webhook URL without an extra round-trip.
    result.tenantSlug = tenantSlug;
    // The store currency lives on the tenant (M1-T31), not in SystemConfig.
    result.currency = await getCurrency();
    return result;
  },

  async getPublicConfig() {
    const config = await this.getSystemConfig();
    return {
      businessName: config.businessName,
      currency: config.currency,
    };
  },

  /**
   * Public config for the checkout form: business name and currency of ONE tenant, found by
   * tenant slug or form slug. Read-only (never seeds a row). 404 for no slug or an unknown slug.
   */
  async getPublicConfigBySlug(slugs: { tenant?: string; form?: string }) {
    const select = {
      id: true,
      name: true,
      systemConfigs: { select: { businessName: true }, take: 1 },
    } as const;
    const tenant = await withoutTenant('public-config-slug', async () => {
      if (slugs.tenant) return prisma.tenant.findUnique({ where: { slug: slugs.tenant }, select });
      const form = slugs.form ? await formTenantBySlug(slugs.form) : null;
      const tenantId = form?.isActive ? form.tenantId : null;
      return tenantId ? prisma.tenant.findUnique({ where: { id: tenantId }, select }) : null;
    });
    if (!tenant) throw new AppError('Not found', 404);

    const config = tenant.systemConfigs[0];
    return {
      businessName: config?.businessName ?? tenant.name ?? null,
      currency: await currencyOfTenant(tenant.id),
    };
  },

  async updateSystemConfig(requester: Requester, data: {
    businessName?: string;
    businessEmail?: string;
    businessPhone?: string;
    businessAddress?: string;
    supportWhatsapp?: string | null;
    contactPerson?: string | null;
    timeZone?: string;
    taxId?: string;
    currency?: string;
    operatingHours?: any;
    smsProvider?: any;
    emailProvider?: any;
    whatsappProvider?: any;
    paystackProvider?: any;
    notificationTemplates?: any;
    features?: Record<string, unknown>;
  }) {
    await this.checkAdminPrivilege(requester, 'super_admin');
    const tenantId = getTenantId();
    const findConfig = () => tenantId
      ? prisma.systemConfig.findUnique({ where: { tenantId } })
      : prisma.systemConfig.findFirst({ where: { tenantId: null } });
    // A new tenant has no row until the first read seeds it; a save before that read must work too.
    let config = await findConfig();
    if (!config) {
      await this.getSystemConfig();
      config = await findConfig();
    }
    if (!config) throw new Error('System config not found');

    // The store currency is Tenant.currency, not a SystemConfig column (M1-T31). The owner can change it at any time.
    const { currency, ...configData } = data;
    data = configData;
    if (currency !== undefined && tenantId) await changeStoreCurrency(tenantId, currency);

    // Business details (M3-T25, F-1230): the support WhatsApp is an international number, the time zone an IANA name.
    if (data.supportWhatsapp) {
      const whatsapp = normalizeInternationalPhone(data.supportWhatsapp);
      if (!whatsapp) throw new AppError('Support WhatsApp must be an international number, for example +233245550103', 400, 'INVALID_WHATSAPP');
      data.supportWhatsapp = whatsapp;
    }
    if (data.timeZone !== undefined && !isValidTimeZone(data.timeZone)) {
      throw new AppError('Time zone must be an IANA name, for example Africa/Accra', 400, 'INVALID_TIME_ZONE');
    }

    // Tenant feature switches (F-402): only the known boolean keys, merged over what is stored so one switch never wipes another.
    if (data.features !== undefined) {
      data.features = parseFeaturePatch(config.features, data.features);
    }

    // Operating hours drive the time-to-first-call clock (M1-T22, F-755): reject a bad shape now, not at read time.
    if (data.operatingHours !== undefined && data.operatingHours !== null) {
      try {
        data.operatingHours = parseOperatingHours(data.operatingHours);
      } catch (error) {
        if (error instanceof RangeError) throw new AppError(error.message, 400, 'INVALID_OPERATING_HOURS');
        throw error;
      }
    }

    // Strip masked placeholders, preserve OAuth state, then encrypt — keyed off
    // SENSITIVE_FIELDS so adding a new integration is a one-line map update.
    for (const providerType of Object.keys(SENSITIVE_FIELDS)) {
      const incoming = (data as any)[providerType];
      if (!incoming) continue;
      const existing = (config as any)[providerType] || {};
      (data as any)[providerType] = preserveMaskedSecrets(providerType, incoming, existing);
    }

    // WhatsApp specifically: also preserve OAuth metadata fields that the admin
    // form doesn't submit but mustn't be overwritten on a manual save.
    if (data.whatsappProvider) {
      const existing = (config.whatsappProvider as any) || {};
      const wp = { ...data.whatsappProvider } as any;
      const oauthFields = [
        'authMode', 'wabaId', 'oauthTokenExpiry', 'oauthConnectedAt',
        'oauthVerifiedName', 'oauthDisplayPhone', 'oauthUserId',
      ];
      for (const field of oauthFields) {
        if (wp[field] === undefined && existing[field] !== undefined) {
          wp[field] = existing[field];
        }
      }
      data.whatsappProvider = wp;
    }

    // Reject mismatched test/live key prefixes before persisting — the mode
    // toggle is decorative without this; tenants would silently route real
    // money through their test account or vice versa.
    if (data.paystackProvider) {
      const pp = data.paystackProvider as any;
      if (pp.secretKey) getPaymentProvider('paystack').validateCredentials?.(pp.mode, decryptString(pp.secretKey) as string);
    }

    // Encrypt sensitive fields before writing to DB
    for (const providerType of Object.keys(SENSITIVE_FIELDS)) {
      if ((data as any)[providerType]) {
        (data as any)[providerType] = encryptProviderSecrets(providerType, (data as any)[providerType]);
      }
    }

    const updatedConfig = await prisma.systemConfig.update({
      where: { id: config.id },
      data,
    });

    // Invalidate provider config caches when settings change
    if (data.features !== undefined && config.tenantId) clearTenantFeaturesCache(config.tenantId);
    if (data.whatsappProvider !== undefined) {
      clearWhatsAppConfigCache();
    }
    if (data.smsProvider !== undefined) {
      const { clearSmsConfigCache } = await import('./smsService');
      clearSmsConfigCache();
    }
    if (data.emailProvider !== undefined) {
      const { clearEmailConfigCache } = await import('./emailService');
      clearEmailConfigCache();
    }
    if (data.paystackProvider !== undefined) {
      // The PaymentConnection row is what checkout reads, so it follows every save here (created if missing). The JSON
      // stays for the old Integrations panel until the Connections page (M9) and is display-only.
      const pp = data.paystackProvider as { mode?: string; publicKey?: string; secretKey?: string; isEnabled?: boolean } | null;
      if (pp && config.tenantId) {
        await saveConnection({
          provider: 'paystack',
          mode: pp.mode === 'live' ? 'live' : 'test',
          publicKey: pp.publicKey,
          secretKey: pp.secretKey ? (decryptString(pp.secretKey) as string) : undefined,
          isEnabled: pp.isEnabled !== false,
        });
      }
      // saveConnection clears the tenant's cached keys itself. Clearing the JSON (pp null) skips it, so clear here.
      // Only this tenant's entry: passing undefined would wipe every tenant's cached secret and stampede the DB.
      if (!pp && config.tenantId) clearPaymentConfigCache(config.tenantId);
    }

    // The public form page caches the support number with the form (5 minutes): a changed number shows at once.
    if (data.supportWhatsapp !== undefined) clearCheckoutFormConfigCache();

    await this.createAuditLog(requester, 'update', 'system_config', config.id.toString(), { changes: Object.keys(data) });

    return updatedConfig;
  },

  // Role Permissions
  async getRolePermissions(_requester?: Requester) {
    // Permissions are needed for login/register response, so we allow read access
    // Note: Update requires strict admin privilege
    const config = await this.getSystemConfig();
    return config.rolePermissions || this.getDefaultPermissions();
  },

  async updateRolePermissions(requester: Requester, permissions: any) {
    await this.checkAdminPrivilege(requester, 'super_admin');
    const config = await this.getSystemConfig();

    const result = await prisma.systemConfig.update({
      where: { id: config.id },
      data: { rolePermissions: permissions },
    });

    await this.createAuditLog(requester, 'update', 'role_permissions', config.id.toString(), { permissions });

    return result;
  },

  getDefaultPermissions() {
    return {
      super_admin: {
        users: ['create', 'view', 'update', 'delete'],
        orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'force_status'],
        customers: ['create', 'view', 'update', 'delete', 'export'],
        products: ['create', 'view', 'update', 'delete', 'update_stock'],
        financial: ['view', 'create', 'update', 'delete'],
        analytics: ['view', 'export'],
        marketing: ['view'],
        workflows: ['create', 'view', 'update', 'delete', 'execute'],
        settings: ['view', 'update'],
        audit: ['view'],
      },
      admin: {
        users: ['create', 'view', 'update', 'delete'],
        orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'update_status'],
        customers: ['create', 'view', 'update', 'delete', 'export'],
        products: ['create', 'view', 'update', 'delete', 'update_stock'],
        financial: ['view', 'create'],
        analytics: ['view', 'export'],
        marketing: ['view'],
        workflows: ['create', 'view', 'update', 'delete', 'execute'],
        settings: ['view'],
        audit: ['view'],
      },
      manager: {
        users: [],
        orders: ['view', 'update', 'bulk_import', 'assign'],
        customers: ['create', 'view', 'update', 'delete', 'export'],
        products: ['view'],
        financial: ['view'],
        analytics: ['view', 'export'],
        marketing: ['view'],
        workflows: ['view', 'execute'],
        settings: [],
      },
      sales_rep: {
        users: [],
        orders: ['create', 'view', 'update'],
        customers: ['create', 'view', 'update'],
        products: ['view'],
        financial: [],
        analytics: ['view'],
        marketing: [],
        workflows: [],
        settings: [],
      },
      inventory_manager: {
        users: [],
        orders: ['view', 'update_status'],
        customers: ['view'],
        products: ['create', 'view', 'update', 'delete', 'update_stock'],
        financial: [],
        analytics: ['view'],
        marketing: [],
        workflows: [],
        settings: [],
      },
      delivery_agent: {
        users: [],
        orders: ['view', 'update'],
        customers: ['view'],
        products: ['view'],
        financial: ['create'],
        analytics: ['view'],
        marketing: [],
        workflows: [],
        settings: [],
      },
      accountant: {
        users: [],
        orders: ['view'],
        customers: ['view'],
        products: ['view'],
        financial: ['view', 'create'],
        analytics: ['view', 'export'],
        marketing: [],
        workflows: [],
        settings: [],
      },
    };
  },

  async getUserById(requester: Requester, userId: number) {
    await this.checkAdminPrivilege(requester, 'admin');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        isAvailable: true,
        lastLogin: true,
        country: true,
        commissionAmount: true,
        vehicleType: true,
        vehicleId: true,
        totalEarnings: true,
        location: true,
        createdAt: true,
        updatedAt: true
      } as any,
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    return user;
  },

  // User Management
  async getAllUsers(requester: Requester, page = 1, limit = 20, role?: UserRole, isActive?: boolean | 'all') {
    await this.checkAdminPrivilege(requester, 'admin');
    const skip = (page - 1) * limit;

    const where: any = { ...HUMAN_USERS_WHERE }; // the per-tenant system user is not staff
    if (role) where.role = role;
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const fetchUsers = () => Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          role: true,
          isActive: true,
          isAvailable: true,
          lastLogin: true,
          country: true,
          commissionAmount: true,
          totalEarnings: true,
          createdAt: true,
        } as any,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    const [users, total] = isActive === 'all'
      ? await withSoftDeleted(fetchUsers)
      : await fetchUsers();

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async createUser(requester: Requester, data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    role: UserRole;
    commissionAmount?: number;
    /** A delivery partner company is `company` (M4-T19). Default: person. */
    kind?: UserKind;
    vehicleType?: string;
    vehicleId?: string;
    /** Create inside the caller's transaction (M4-T19). The caller writes the audit row for the whole unit of work. */
    tx?: TransactionClient;
  }) {
    await this.checkAdminPrivilege(requester, 'admin');

    // Prevent privilege escalation: cannot create a user with a higher or equal role
    if (!canManageRole(requester.role, data.role)) {
      throw new AppError(`Access denied: Cannot create a user with ${data.role} role.`, 403);
    }

    // Service-level password policy enforcement
    if (!data.password || data.password.length < 8) {
      throw new AppError('Password must be at least 8 characters long.', 400);
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await (data.tx ?? prisma).user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: data.phoneNumber,
        role: data.role,
        password: hashedPassword,
        commissionAmount: data.commissionAmount || 0,
        ...(data.kind && { kind: data.kind }),
        ...(data.vehicleType && { vehicleType: data.vehicleType }),
        ...(data.vehicleId && { vehicleId: data.vehicleId }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        country: true,
        commissionAmount: true,
        createdAt: true,
      } as any,
    });

    if (!data.tx) await this.createAuditLog(requester, 'create', 'user', user.id.toString(), { email: user.email, role: user.role });

    return user;
  },

  async updateUser(requester: Requester, userId: number, data: {
    email?: string;
    name?: string;
    phoneNumber?: string;
    role?: UserRole;
    isActive?: boolean;
    commissionAmount?: number;
  }) {
    await this.checkAdminPrivilege(requester, 'admin');

    // withSoftDeleted bypasses the soft-delete auto-inject so this lookup
    // can find inactive users — admins must be able to reactivate them.
    const targetUser = await withSoftDeleted(() => prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    }));

    if (!targetUser) {
      throw new AppError('User not found', 404);
    }

    // Role management protection
    if (data.role) {
      // 1. Cannot promote self (prevent self-role escalation)
      if (requester.id === userId && requester.role !== data.role) {
        throw new AppError('Access denied: Cannot change your own role.', 403);
      }

      // 2. Cannot promote to a role higher than your own
      if (!canManageRole(requester.role, data.role)) {
        throw new AppError(`Access denied: Cannot promote user to ${data.role} role.`, 403);
      }

      // 3. Cannot modify a user with a higher role than your own
      if (!canManageRole(requester.role, targetUser.role)) {
        throw new AppError('Access denied: Cannot modify a user with a higher role.', 403);
      }
    }

    const updateData: any = { ...data };
    // A delivery partner has no pay rate any more (F-915): a client that still sends deliveryRate is ignored.
    delete updateData.deliveryRate;

    // If name is provided, split it into firstName and lastName
    if (data.name !== undefined) {
      const nameParts = data.name.trim().split(' ');
      updateData.firstName = nameParts[0] || 'Unknown';
      updateData.lastName = nameParts.slice(1).join(' ') || '';
      delete updateData.name;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        country: true,
        commissionAmount: true,
        createdAt: true,
      } as any,
    });

    // Deactivating signs the user out of every device at once (F-1224)
    if (data.isActive === false) await sessionService.revokeAll(userId);

    await this.createAuditLog(requester, 'update', 'user', userId.toString(), { changes: Object.keys(data) });

    return updatedUser;
  },

  async resetUserPassword(requester: Requester, userId: number, newPassword: string) {
    await this.checkAdminPrivilege(requester, 'admin');

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!targetUser) {
      throw new AppError('User not found', 404);
    }

    if (!canManageRole(requester.role, targetUser.role)) {
      throw new AppError('Access denied: Cannot reset password for a user with a higher role.', 403);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        refreshToken: null, // Force re-login
      },
    });

    await sessionService.revokeAll(userId);

    await this.createAuditLog(requester, 'reset_password', 'user', userId.toString());

    return updatedUser;
  },

  async deleteUser(requester: Requester, userId: number) {
    await this.checkAdminPrivilege(requester, 'admin');

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!targetUser) {
      throw new AppError('User not found', 404);
    }

    if (!canManageRole(requester.role, targetUser.role)) {
      throw new AppError('Access denied: Cannot deactivate a user with a higher role.', 403);
    }

    const result = await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    await sessionService.revokeAll(userId);

    await this.createAuditLog(requester, 'deactivate', 'user', userId.toString());

    return result;
  },

  async permanentlyDeleteUser(requester: Requester, userId: number) {
    await this.checkAdminPrivilege(requester, 'super_admin');
    // Step 1: Nullify order references (preserves order history)
    await prisma.order.updateMany({
      where: {
        OR: [
          { customerRepId: userId },
          { deliveryAgentId: userId },
          { createdById: userId }
        ]
      },
      data: {
        customerRepId: null,
        deliveryAgentId: null,
        createdById: null
      }
    });

    // Step 2: Nullify delivery agent references (preserves delivery history)
    await prisma.delivery.updateMany({
      where: { agentId: userId },
      data: { agentId: null }
    });

    // Step 3: Nullify expense records (keep for accounting)
    await prisma.expense.updateMany({
      where: { recordedBy: userId },
      data: { recordedBy: null }
    });

    // Step 4: Delete user's personal notifications
    await prisma.notification.deleteMany({
      where: { userId: userId }
    });

    // Step 5: Permanently delete the user
    await prisma.user.delete({
      where: { id: userId }
    });

    await this.createAuditLog(requester, 'permanent_delete', 'user', userId.toString());
  },
};
