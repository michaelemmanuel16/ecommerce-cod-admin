import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

/** True for a unique-key violation (P2002): the loser of two writes to one key. */
export const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** True for P2025: the row an update or delete named does not exist (or no longer matches its filters). */
export const isRecordNotFound = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

/** True for a foreign-key violation (P2003): a row that other rows still point at. */
export const isForeignKeyViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';

/** The plain 409 for a user email that is taken (email is unique across all tenants), or null for any other error. */
export const emailConflictOf = (error: unknown): AppError | null =>
  isUniqueViolation(error) && String((error as Prisma.PrismaClientKnownRequestError).meta?.target ?? '').includes('email')
    ? new AppError('A user with this email already exists', 409, 'EMAIL_EXISTS')
    : null;
