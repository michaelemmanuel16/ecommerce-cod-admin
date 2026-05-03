import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { promptInput, promptPassword } from './lib/prompts';

const prisma = new PrismaClient();

interface AdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}

/**
 * Bootstrap Admin User Creation Script
 *
 * This script runs during first deployment to create an initial admin user.
 * It only runs if the database is completely empty (no users exist).
 *
 * Usage:
 * 1. Interactive mode: npm run bootstrap
 * 2. Environment variables: Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, etc.
 */


async function getAdminInputFromEnv(): Promise<AdminInput | null> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const firstName = process.env.BOOTSTRAP_ADMIN_FIRST_NAME || 'Admin';
  const lastName = process.env.BOOTSTRAP_ADMIN_LAST_NAME || 'User';
  const phoneNumber = process.env.BOOTSTRAP_ADMIN_PHONE || '+1234567890';

  if (email && password) {
    return { email, password, firstName, lastName, phoneNumber };
  }

  return null;
}

async function getAdminInputInteractive(): Promise<AdminInput> {
  console.log('\n📝 Please provide admin user details:');
  console.log('━'.repeat(50));

  const email = await promptInput('Email address: ');
  const password = await promptPassword('Password (min 8 characters): ');
  const firstName = await promptInput('First name (default: Admin): ') || 'Admin';
  const lastName = await promptInput('Last name (default: User): ') || 'User';
  const phoneNumber = await promptInput('Phone number (default: +1234567890): ') || '+1234567890';

  return { email, password, firstName, lastName, phoneNumber };
}

function validateAdminInput(input: AdminInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!input.email || !input.email.includes('@')) {
    errors.push('Invalid email address');
  }

  if (!input.password || input.password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (!input.firstName || input.firstName.length < 2) {
    errors.push('First name must be at least 2 characters');
  }

  if (!input.lastName || input.lastName.length < 2) {
    errors.push('Last name must be at least 2 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

async function bootstrapAdmin(): Promise<void> {
  try {
    console.log('🔍 Checking if database needs bootstrapping...');

    // Check if any users exist
    const userCount = await prisma.user.count();

    if (userCount > 0) {
      console.log('✅ Database already has users. Skipping bootstrap.');
      console.log(`   Found ${userCount} user(s) in database.`);
      return;
    }

    console.log('📦 Empty database detected. Creating initial admin user...');

    // Try to get admin details from environment variables first
    let adminInput = await getAdminInputFromEnv();

    if (!adminInput) {
      // If not in environment, check if we're in interactive mode
      if (process.stdin.isTTY) {
        adminInput = await getAdminInputInteractive();
      } else {
        console.error('❌ ERROR: No admin credentials provided!');
        console.error('\nTo bootstrap the admin user, either:');
        console.error('1. Set environment variables:');
        console.error('   - BOOTSTRAP_ADMIN_EMAIL');
        console.error('   - BOOTSTRAP_ADMIN_PASSWORD');
        console.error('   - BOOTSTRAP_ADMIN_FIRST_NAME (optional)');
        console.error('   - BOOTSTRAP_ADMIN_LAST_NAME (optional)');
        console.error('   - BOOTSTRAP_ADMIN_PHONE (optional)');
        console.error('\n2. Run interactively: npm run bootstrap');
        process.exit(1);
      }
    }

    // Validate input
    const validation = validateAdminInput(adminInput);
    if (!validation.valid) {
      console.error('❌ Invalid admin details:');
      validation.errors.forEach((error) => console.error(`   - ${error}`));
      process.exit(1);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(adminInput.password, 10);

    // Create admin user
    const user = await prisma.user.create({
      data: {
        email: adminInput.email,
        password: hashedPassword,
        firstName: adminInput.firstName,
        lastName: adminInput.lastName,
        phoneNumber: adminInput.phoneNumber,
        role: 'super_admin',
        isActive: true,
        isAvailable: true,
      },
    });

    console.log('\n✅ Admin user created successfully!');
    console.log('━'.repeat(50));
    console.log(`Email: ${user.email}`);
    console.log(`Name: ${user.firstName} ${user.lastName}`);
    console.log(`Role: ${user.role}`);
    console.log(`User ID: ${user.id}`);
    console.log('━'.repeat(50));
    console.log('\n🎉 You can now sign in with these credentials!');
  } catch (error) {
    console.error('❌ Error during bootstrap:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the bootstrap
bootstrapAdmin()
  .then(() => {
    console.log('\n✨ Bootstrap complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Bootstrap failed:', error);
    process.exit(1);
  });
