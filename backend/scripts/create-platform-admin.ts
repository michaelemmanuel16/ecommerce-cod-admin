import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import * as readline from 'readline';

const prisma = new PrismaClient();

interface PlatformAdminInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Create or promote a platform admin user.
 *
 * Platform admins have isPlatformAdmin=true and tenantId=null — they bypass
 * tenant scoping (via prismaExtensions.ts) and can manage all tenants via
 * /api/platform/* endpoints.
 *
 * Modes:
 *   Env-driven:  PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD,
 *                PLATFORM_ADMIN_FIRST_NAME (optional),
 *                PLATFORM_ADMIN_LAST_NAME  (optional)
 *   Interactive: npm run create-platform-admin and answer prompts
 *
 * Promote-or-create: if a user with that email exists, this script promotes
 * them (sets isPlatformAdmin=true, tenantId=null). Password is updated only
 * if a new one is supplied.
 */

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const DEL = String.fromCharCode(127);

async function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let password = '';
    process.stdout.write(question);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on('data', (char) => {
      const str = char.toString('utf-8');
      if (str === '\n' || str === '\r' || str === CTRL_D) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        rl.close();
        process.stdout.write('\n');
        resolve(password);
      } else if (str === CTRL_C) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(0);
      } else if (str === DEL || str === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else if (str >= ' ' && str <= '~') {
        password += str;
        process.stdout.write('*');
      }
    });
  });
}

function getInputFromEnv(): PlatformAdminInput | null {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const firstName = process.env.PLATFORM_ADMIN_FIRST_NAME || 'Platform';
  const lastName = process.env.PLATFORM_ADMIN_LAST_NAME || 'Admin';
  if (email && password) return { email, password, firstName, lastName };
  return null;
}

async function getInputInteractive(existingUser: boolean): Promise<PlatformAdminInput> {
  console.log('\nPlatform admin details:');
  console.log('-'.repeat(50));
  const email = await promptInput('Email: ');
  const password = await promptPassword(
    existingUser
      ? 'New password (leave blank to keep existing): '
      : 'Password (min 8 chars): '
  );
  const firstName = (await promptInput('First name (default: Platform): ')) || 'Platform';
  const lastName = (await promptInput('Last name (default: Admin): ')) || 'Admin';
  return { email, password, firstName, lastName };
}

function validateInput(input: PlatformAdminInput, existingUser: boolean): string[] {
  const errors: string[] = [];
  if (!input.email || !input.email.includes('@')) errors.push('Invalid email');
  if (!existingUser && (!input.password || input.password.length < 8)) {
    errors.push('Password must be at least 8 characters');
  }
  if (existingUser && input.password && input.password.length > 0 && input.password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!input.firstName || input.firstName.length < 2) errors.push('First name too short');
  if (!input.lastName || input.lastName.length < 2) errors.push('Last name too short');
  return errors;
}

async function run(): Promise<void> {
  console.log('Create or promote platform admin');

  let input = getInputFromEnv();
  let existingUser: { id: number; email: string; isPlatformAdmin: boolean } | null = null;

  if (input) {
    existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, isPlatformAdmin: true },
    });
  } else {
    if (!process.stdin.isTTY) {
      console.error('No credentials provided.');
      console.error('Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD, or run interactively.');
      process.exit(1);
    }
    const tempEmail = await promptInput('Email: ');
    existingUser = await prisma.user.findUnique({
      where: { email: tempEmail },
      select: { id: true, email: true, isPlatformAdmin: true },
    });
    const rest = await getInputInteractive(!!existingUser);
    input = { ...rest, email: tempEmail };
  }

  const errors = validateInput(input, !!existingUser);
  if (errors.length) {
    console.error('Invalid input:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const data: {
    isPlatformAdmin: boolean;
    isActive: boolean;
    tenantId: null;
    password?: string;
  } = {
    isPlatformAdmin: true,
    isActive: true,
    tenantId: null,
  };
  if (input.password && input.password.length >= 8) {
    data.password = await bcrypt.hash(input.password, 10);
  }

  let user;
  if (existingUser) {
    user = await prisma.user.update({
      where: { id: existingUser.id },
      data,
    });
    console.log(`\nPromoted existing user to platform admin: ${user.email}`);
  } else {
    user = await prisma.user.create({
      data: {
        email: input.email,
        password: data.password!,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'super_admin',
        isActive: true,
        isPlatformAdmin: true,
        tenantId: null,
      },
    });
    console.log(`\nCreated new platform admin: ${user.email}`);
  }

  console.log('-'.repeat(50));
  console.log(`User ID:         ${user.id}`);
  console.log(`Email:           ${user.email}`);
  console.log(`Name:            ${user.firstName} ${user.lastName}`);
  console.log(`isPlatformAdmin: ${user.isPlatformAdmin}`);
  console.log(`tenantId:        ${user.tenantId ?? 'null (cross-tenant)'}`);
  console.log('-'.repeat(50));
  console.log('\nSign in at https://platform.codadminpro.com/login');
}

run()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
