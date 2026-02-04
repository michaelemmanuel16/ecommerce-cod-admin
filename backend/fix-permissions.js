const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const rolePermissions = {
    super_admin: {
        users: ['create', 'view', 'update', 'delete'],
        orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
        customers: ['create', 'view', 'update', 'delete'],
        products: ['create', 'view', 'update', 'delete', 'update_stock'],
        financial: ['view', 'create', 'update', 'delete'],
        analytics: ['view'],
        workflows: ['create', 'view', 'update', 'delete', 'execute'],
        settings: ['view', 'update'],
        calls: ['create', 'view', 'update', 'delete'],
        gl: ['create', 'view', 'update', 'delete'],
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
        calls: ['create', 'view', 'update', 'delete'],
        gl: ['create', 'view', 'update', 'delete'],
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
        calls: ['view'],
        gl: ['view'],
    },
    sales_rep: {
        users: [],
        orders: ['create', 'view', 'update'],
        customers: ['create', 'view', 'update', 'delete'],
        products: ['view'],
        financial: [],
        analytics: ['view'],
        workflows: [],
        settings: [],
        calls: ['create', 'view'],
        gl: [],
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
        calls: [],
        gl: [],
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
        calls: [],
        gl: [],
    },
    accountant: {
        users: [],
        orders: ['view'],
        customers: ['view'],
        products: ['view'],
        financial: ['view', 'create'],
        analytics: ['view'],
        workflows: [],
        calls: [],
        settings: [],
        gl: ['create', 'view', 'update'],
    },
};

async function updatePermissions() {
    try {
        console.log('Updating role permissions in database...');

        const config = await prisma.systemConfig.findFirst();

        if (config) {
            await prisma.systemConfig.update({
                where: { id: config.id },
                data: { rolePermissions }
            });
            console.log('✅ Successfully updated role permissions');
        } else {
            await prisma.systemConfig.create({
                data: {
                    businessName: 'COD Admin',
                    rolePermissions
                }
            });
            console.log('✅ Successfully created system config with role permissions');
        }

        console.log('\nSales Rep Permissions:', JSON.stringify(rolePermissions.sales_rep, null, 2));
    } catch (error) {
        console.error('❌ Error updating permissions:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

updatePermissions();
