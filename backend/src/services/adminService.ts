import prisma from '../utils/prisma';
import bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

export const adminService = {
  // System Config
  async getSystemConfig() {
    let config = await prisma.systemConfig.findFirst();

    if (!config) {
      // Create default config if none exists
      config = await prisma.systemConfig.create({
        data: {
          currency: 'USD',
          rolePermissions: this.getDefaultPermissions(),
        },
      });
    }

    return config;
  },

  async getPublicConfig() {
    const config = await this.getSystemConfig();
    return {
      businessName: config.businessName,
      currency: config.currency,
    };
  },

  async updateSystemConfig(data: {
    businessName?: string;
    businessEmail?: string;
    businessPhone?: string;
    businessAddress?: string;
    taxId?: string;
    currency?: string;
    operatingHours?: any;
    smsProvider?: any;
    emailProvider?: any;
    notificationTemplates?: any;
  }) {
    const config = await this.getSystemConfig();

    return prisma.systemConfig.update({
      where: { id: config.id },
      data,
    });
  },

  // Role Permissions
  async getRolePermissions() {
    const config = await this.getSystemConfig();
    return config.rolePermissions || this.getDefaultPermissions();
  },

  async updateRolePermissions(permissions: any) {
    const config = await this.getSystemConfig();

    return prisma.systemConfig.update({
      where: { id: config.id },
      data: { rolePermissions: permissions },
    });
  },

  getDefaultPermissions() {
    return {
      super_admin: {
        users: ['create', 'view', 'update', 'delete'],
        orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
        customers: ['create', 'view', 'update', 'delete'],
        products: ['create', 'view', 'update', 'delete', 'update_stock'],
        financial: ['view', 'create', 'update', 'delete'],
        analytics: ['view'],
        workflows: ['create', 'view', 'update', 'delete', 'execute'],
        settings: ['view', 'update'],
      },
      admin: {
        users: ['create', 'view', 'update', 'delete'],
        orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
        customers: ['create', 'view', 'update', 'delete'],
        products: ['create', 'view', 'update', 'delete'],
        financial: ['view', 'create'],
        analytics: ['view'],
        workflows: ['create', 'view', 'update', 'delete', 'execute'],
        settings: ['view'],
      },
      manager: {
        users: [],
        orders: ['view', 'update', 'bulk_import', 'assign'],
        customers: ['create', 'view', 'update', 'delete'],
        products: ['view'],
        financial: ['view'],
        analytics: ['view'],
        workflows: ['view', 'execute'],
        settings: [],
      },
      sales_rep: {
        users: [],
        orders: ['create', 'view', 'update'],
        customers: ['create', 'view', 'update', 'delete'],
        products: ['view'],
        financial: [],
        analytics: [],
        workflows: [],
        settings: [],
      },
      inventory_manager: {
        users: [],
        orders: ['view'],
        customers: ['view'],
        products: ['create', 'view', 'update', 'delete', 'update_stock'],
        financial: [],
        analytics: ['view'],
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
        workflows: [],
        settings: [],
      },
      accountant: {
        users: [],
        orders: ['view'],
        customers: ['view'],
        products: ['view'],
        financial: ['view', 'create'],
        analytics: ['view'],
        workflows: [],
        settings: [],
      },
    };
  },

  // User Management
  async getAllUsers(page = 1, limit = 20, role?: UserRole, isActive?: boolean) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (role) where.role = role;
    if (typeof isActive === 'boolean') where.isActive = isActive;

    const [users, total] = await Promise.all([
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
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async createUser(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    role: UserRole;
  }) {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    return prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phoneNumber: data.phoneNumber,
        role: data.role,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  },

  async updateUser(userId: number, data: {
    email?: string;
    name?: string;
    phoneNumber?: string;
    role?: UserRole;
    isActive?: boolean;
  }) {
    const updateData: any = { ...data };

    // If name is provided, split it into firstName and lastName
    if (data.name !== undefined) {
      const nameParts = data.name.trim().split(' ');
      updateData.firstName = nameParts[0] || 'Unknown';
      updateData.lastName = nameParts.slice(1).join(' ') || '';
      delete updateData.name;
    }

    return prisma.user.update({
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
        createdAt: true,
      },
    });
  },

  async resetUserPassword(userId: number, newPassword: string) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    return prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        refreshToken: null, // Force re-login
      },
    });
  },

  async deleteUser(userId: number) {
    return prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
  },

  async permanentlyDeleteUser(userId: number) {
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
  },
};
