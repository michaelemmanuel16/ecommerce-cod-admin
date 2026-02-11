import dotenv from 'dotenv';
dotenv.config();

import { generateAccessToken } from '../src/utils/jwt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function generateToken() {
    try {
        const user = await (prisma as any).user.findFirst({
            where: { email: 'rep1@codadmin.com' }
        });

        if (!user) {
            process.exit(1);
        }

        const token = generateAccessToken({
            id: user.id,
            email: user.email,
            role: user.role
        });

        process.stdout.write(token);
    } catch (error) {
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

generateToken();
