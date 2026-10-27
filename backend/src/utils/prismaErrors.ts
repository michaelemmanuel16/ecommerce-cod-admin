import { Prisma } from '@prisma/client';

/** True for a unique-key violation (P2002): the loser of two writes to one key. */
export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
