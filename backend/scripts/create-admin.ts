import dotenv from 'dotenv';
dotenv.config();

import prisma from '../src/utils/prisma';
import bcrypt from 'bcrypt';

async function createAdminUser() {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';
    const password = process.env.ADMIN_PASSWORD || 'admin123';

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      console.log(`✅ Admin user already exists: ${email}`);
      process.exit(0);
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        role: 'super_admin',
        isActive: true,
        isAvailable: true
      }
    });

    console.log(`✅ Admin user created successfully!`);
    console.log(`
    ╔═══════════════════════════════════════════════════════╗
    ║                                                       ║
    ║   Admin Account Created                               ║
    ║                                                       ║
    ║   Email:    ${email.padEnd(38)}  ║
    ║   Password: ${password.padEnd(38)}  ║
    ║   Role:     super_admin                               ║
    ║                                                       ║
    ║   Login at: http://localhost:5173/login               ║
    ║                                                       ║
    ╚═══════════════════════════════════════════════════════╝
    `);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  }
}

createAdminUser();
