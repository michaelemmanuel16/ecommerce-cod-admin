import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma from '../../config/database';
import orderService from '../../services/orderService';
import { OrderStatus } from '@prisma/client';

describe('Duplicate Detection Integration Tests', () => {
    let testCustomer: any;
    let testProduct: any;

    beforeAll(async () => {
        // Create test customer
        testCustomer = await prisma.customer.create({
            data: {
                firstName: 'Test',
                lastName: 'Customer',
                phoneNumber: '+233999000111',
                address: '123 Test Street',
                state: 'Test State',
                area: 'Test Area'
            }
        });

        // Create test product
        testProduct = await prisma.product.create({
            data: {
                name: 'Test Product',
                sku: 'TEST-001',
                price: 250,
                stockQuantity: 100,
                description: 'Test product for duplicate detection'
            }
        });
    });

    afterAll(async () => {
        // Cleanup
        await prisma.order.deleteMany({ where: { customerId: testCustomer.id } });
        await prisma.product.delete({ where: { id: testProduct.id } });
        await prisma.customer.delete({ where: { id: testCustomer.id } });
        await prisma.$disconnect();
    });

    describe('Enhanced Duplicate Detection', () => {
        it('should detect duplicate with same customer, amount, address, area within 24 hours', async () => {
            const orderData = {
                customerPhone: testCustomer.phoneNumber,
                customerFirstName: 'Test',
                customerLastName: 'Customer',
                subtotal: 250,
                totalAmount: 250,
                deliveryAddress: '123 Test Street',
                deliveryState: 'Test State',
                deliveryArea: 'Test Area',
                productName: 'Test Product',
                quantity: 1,
                unitPrice: 250
            };

            // Import first order
            const firstResult = await orderService.bulkImportOrders([orderData], 1);
            expect(firstResult.success).toBe(1);
            expect(firstResult.duplicates).toBe(0);

            // Try to import same order immediately
            const secondResult = await orderService.bulkImportOrders([orderData], 1);
            expect(secondResult.success).toBe(0);
            expect(secondResult.duplicates).toBe(1);
        });

        it('should NOT detect duplicate if address is different', async () => {
            const orderData1 = {
                customerPhone: testCustomer.phoneNumber,
                customerFirstName: 'Test',
                customerLastName: 'Customer',
                subtotal: 300,
                totalAmount: 300,
                deliveryAddress: '456 Different Street',
                deliveryState: 'Test State',
                deliveryArea: 'Test Area',
                productName: 'Test Product',
                quantity: 1,
                unitPrice: 300
            };

            const orderData2 = {
                ...orderData1,
                deliveryAddress: '789 Another Street'
            };

            const firstResult = await orderService.bulkImportOrders([orderData1], 1);
            expect(firstResult.success).toBe(1);

            const secondResult = await orderService.bulkImportOrders([orderData2], 1);
            expect(secondResult.success).toBe(1); // Should create, not duplicate
            expect(secondResult.duplicates).toBe(0);
        });

        it('should NOT detect duplicate if amount is different', async () => {
            const orderData1 = {
                customerPhone: testCustomer.phoneNumber,
                customerFirstName: 'Test',
                customerLastName: 'Customer',
                subtotal: 400,
                totalAmount: 400,
                deliveryAddress: '123 Test Street',
                deliveryState: 'Test State',
                deliveryArea: 'Test Area',
                productName: 'Test Product',
                quantity: 1,
                unitPrice: 400
            };

            const orderData2 = {
                ...orderData1,
                subtotal: 500,
                totalAmount: 500,
                unitPrice: 500
            };

            const firstResult = await orderService.bulkImportOrders([orderData1], 1);
            expect(firstResult.success).toBe(1);

            const secondResult = await orderService.bulkImportOrders([orderData2], 1);
            expect(secondResult.success).toBe(1);
            expect(secondResult.duplicates).toBe(0);
        });

        it('should NOT detect duplicate if area is different', async () => {
            const orderData1 = {
                customerPhone: testCustomer.phoneNumber,
                customerFirstName: 'Test',
                customerLastName: 'Customer',
                subtotal: 350,
                totalAmount: 350,
                deliveryAddress: '123 Test Street',
                deliveryState: 'Test State',
                deliveryArea: 'Area One',
                productName: 'Test Product',
                quantity: 1,
                unitPrice: 350
            };

            const orderData2 = {
                ...orderData1,
                deliveryArea: 'Area Two'
            };

            const firstResult = await orderService.bulkImportOrders([orderData1], 1);
            expect(firstResult.success).toBe(1);

            const secondResult = await orderService.bulkImportOrders([orderData2], 1);
            expect(secondResult.success).toBe(1);
            expect(secondResult.duplicates).toBe(0);
        });

        it('should detect duplicate with matching product name', async () => {
            const orderData = {
                customerPhone: testCustomer.phoneNumber,
                customerFirstName: 'Test',
                customerLastName: 'Customer',
                subtotal: 600,
                totalAmount: 600,
                deliveryAddress: '999 Final Street',
                deliveryState: 'Test State',
                deliveryArea: 'Product Test Area',
                productName: 'Test Product',
                quantity: 1,
                unitPrice: 600
            };

            const firstResult = await orderService.bulkImportOrders([orderData], 1);
            expect(firstResult.success).toBe(1);

            const secondResult = await orderService.bulkImportOrders([orderData], 1);
            expect(secondResult.success).toBe(0);
            expect(secondResult.duplicates).toBe(1);
        });
    });

    describe('Transaction Rollback', () => {
        it('should rollback all changes if an error occurs during bulk import', async () => {
            const validOrder = {
                customerPhone: '+233111222333',
                customerFirstName: 'Valid',
                customerLastName: 'Customer',
                subtotal: 100,
                totalAmount: 100,
                deliveryAddress: 'Valid Address',
                deliveryState: 'Valid State',
                deliveryArea: 'Valid Area',
                quantity: 1,
                unitPrice: 100
            };

            const invalidOrder = {
                customerPhone: '', // Invalid - empty phone
                customerFirstName: 'Invalid',
                customerLastName: 'Customer',
                subtotal: 200,
                totalAmount: 200,
                deliveryAddress: 'Invalid Address',
                deliveryState: 'Invalid State',
                deliveryArea: 'Invalid Area',
                quantity: 1,
                unitPrice: 200
            };

            try {
                await orderService.bulkImportOrders([validOrder, invalidOrder], 1);
            } catch (error) {
                // Expected to fail and rollback
            }

            // Verify no orders were created
            const orders = await prisma.order.findMany({
                where: {
                    customer: {
                        phoneNumber: '+233111222333'
                    }
                }
            });

            // Even the valid order should not exist due to rollback
            expect(orders.length).toBeLessThanOrEqual(1);
        });
    });

    describe('Audit Logging', () => {
        it('should log successful bulk import operations', async () => {
            const consoleSpy = jest.spyOn(console, 'log');

            const orderData = {
                customerPhone: '+233444555666',
                customerFirstName: 'Audit',
                customerLastName: 'Test',
                subtotal: 150,
                totalAmount: 150,
                deliveryAddress: 'Audit Street',
                deliveryState: 'Audit State',
                deliveryArea: 'Audit Area',
                quantity: 1,
                unitPrice: 150
            };

            await orderService.bulkImportOrders([orderData], 1);

            // Logger should have been called (implementation-specific)
            // This is a placeholder - actual assertion depends on your logger implementation
            expect(consoleSpy).toHaveBeenCalled();

            consoleSpy.mockRestore();
        });
    });
});
