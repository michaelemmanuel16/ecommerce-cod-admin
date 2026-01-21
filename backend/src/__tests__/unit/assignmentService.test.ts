import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import assignmentService from '../../services/assignmentService';
import prisma from '../../utils/prisma';

// Mock prisma
jest.mock('../../utils/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findMany: jest.fn(),
        },
    },
}));

describe('AssignmentService', () => {
    const mockPrisma = prisma as any;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getUsersByRole', () => {
        it('should filter out blocked agents', async () => {
            const mockUsers = [
                { id: 1, firstName: 'Available Agent', role: 'delivery_agent', isActive: true, isAvailable: true },
            ];

            mockPrisma.user.findMany.mockResolvedValue(mockUsers);

            const result = await assignmentService.getUsersByRole('delivery_agent');

            expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    role: 'delivery_agent',
                    balance: {
                        OR: [
                            { isBlocked: false },
                            { isBlocked: null }
                        ]
                    }
                })
            }));
            expect(result).toEqual(mockUsers);
        });

        it('should NOT apply blocking filter for other roles', async () => {
            const mockUsers = [
                { id: 10, firstName: 'Sales Rep', role: 'sales_rep', isActive: true, isAvailable: true },
            ];

            mockPrisma.user.findMany.mockResolvedValue(mockUsers);

            await assignmentService.getUsersByRole('sales_rep');

            expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: {
                    role: 'sales_rep',
                    isActive: true,
                    isAvailable: true
                }
            }));
        });
    });
});
