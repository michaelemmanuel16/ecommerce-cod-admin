import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function seedAdminUser() {
    try {
        console.log('🌱 Seeding admin user...');

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: 'admin@codadmin.com' }
        });

        if (existingUser) {
            console.log('✅ Admin user already exists');
            return;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash('password123', 10);

        // Create admin user
        const adminUser = await prisma.user.create({
            data: {
                email: 'admin@codadmin.com',
                password: hashedPassword,
                firstName: 'Admin',
                lastName: 'User',
                role: 'super_admin',
                isActive: true,
                phoneNumber: '+1234567890',
            }
        });

        console.log('✅ Admin user created successfully');
        console.log('📧 Email: admin@codadmin.com');
        console.log('🔑 Password: password123');
        console.log('👤 Role: super_admin');
        console.log(`🆔 User ID: ${adminUser.id}`);

    } catch (error) {
        console.error('❌ Error seeding admin user:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

seedAdminUser();
