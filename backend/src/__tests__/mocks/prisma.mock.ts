import { jest, beforeEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

// Create a deep mock of PrismaClient
export const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

// Reset mock before each test
beforeEach(() => {
  mockReset(prismaMock);
});

// Mock the prisma client
jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: prismaMock,
  prismaBase: prismaMock,
}));

export default prismaMock;
