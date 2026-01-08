import { describe, it, expect } from '@jest/globals';
import { bulkImportOrderSchema, exportQuerySchema } from '../../utils/bulkOrderValidators';
import { z } from 'zod';

describe('Bulk Order Validators', () => {
    describe('bulkImportOrderSchema', () => {
        it('should validate a valid order', () => {
            const validOrder = {
                customerPhone: '+233123456789',
                customerFirstName: 'John',
                customerLastName: 'Doe',
                customerAlternatePhone: '',
                subtotal: 250,
                totalAmount: 250,
                deliveryAddress: '123 Main Street, Accra',
                deliveryState: 'Greater Accra',
                deliveryArea: 'East Legon',
                productName: 'Premium Package',
                quantity: 1,
                unitPrice: 250,
                status: undefined,
                notes: ''
            };

            const result = bulkImportOrderSchema.safeParse(validOrder);
            expect(result.success).toBe(true);
        });

        it('should reject order with invalid phone number', () => {
            const invalidOrder = {
                customerPhone: '123', // Too short
                customerFirstName: 'John',
                customerLastName: 'Doe',
                subtotal: 250,
                totalAmount: 250,
                deliveryAddress: '123 Main Street',
                deliveryState: 'Greater Accra',
                deliveryArea: 'East Legon'
            };

            const result = bulkImportOrderSchema.safeParse(invalidOrder);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain('at least 10 digits');
            }
        });

        it('should reject order with negative amount', () => {
            const invalidOrder = {
                customerPhone: '+233123456789',
                customerFirstName: 'John',
                customerLastName: 'Doe',
                subtotal: -100, // Negative
                totalAmount: -100,
                deliveryAddress: '123 Main Street',
                deliveryState: 'Greater Accra',
                deliveryArea: 'East Legon'
            };

            const result = bulkImportOrderSchema.safeParse(invalidOrder);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues.some(issue => issue.message.includes('positive'))).toBe(true);
            }
        });

        it('should reject order with too short address', () => {
            const invalidOrder = {
                customerPhone: '+233123456789',
                customerFirstName: 'John',
                customerLastName: 'Doe',
                subtotal: 250,
                totalAmount: 250,
                deliveryAddress: 'abc', // Too short
                deliveryState: 'Greater Accra',
                deliveryArea: 'East Legon'
            };

            const result = bulkImportOrderSchema.safeParse(invalidOrder);
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain('at least 5 characters');
            }
        });

        it('should accept order with valid alternate phone', () => {
            const validOrder = {
                customerPhone: '+233123456789',
                customerFirstName: 'John',
                customerLastName: 'Doe',
                customerAlternatePhone: '+233987654321',
                subtotal: 250,
                totalAmount: 250,
                deliveryAddress: '123 Main Street, Accra',
                deliveryState: 'Greater Accra',
                deliveryArea: 'East Legon'
            };

            const result = bulkImportOrderSchema.safeParse(validOrder);
            expect(result.success).toBe(true);
        });

        it('should reject order with invalid phone format', () => {
            const invalidOrder = {
                customerPhone: 'not-a-phone-number',
                customerFirstName: 'John',
                customerLastName: 'Doe',
                subtotal: 250,
                totalAmount: 250,
                deliveryAddress: '123 Main Street',
                deliveryState: 'Greater Accra',
                deliveryArea: 'East Legon'
            };

            const result = bulkImportOrderSchema.safeParse(invalidOrder);
            expect(result.success).toBe(false);
        });
    });

    describe('exportQuerySchema', () => {
        it('should validate valid export query', () => {
            const validQuery = {
                format: 'csv',
                status: 'pending_confirmation',
                startDate: '2026-01-01',
                endDate: '2026-01-31'
            };

            const result = exportQuerySchema.safeParse(validQuery);
            expect(result.success).toBe(true);
        });

        it('should default format to csv if not provided', () => {
            const query = {};

            const result = exportQuerySchema.safeParse(query);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.format).toBe('csv');
            }
        });

        it('should reject invalid date format', () => {
            const invalidQuery = {
                startDate: 'not-a-date'
            };

            const result = exportQuerySchema.safeParse(invalidQuery);
            expect(result.success).toBe(false);
        });

        it('should accept xlsx format', () => {
            const validQuery = {
                format: 'xlsx'
            };

            const result = exportQuerySchema.safeParse(validQuery);
            expect(result.success).toBe(true);
        });

        it('should reject invalid format', () => {
            const invalidQuery = {
                format: 'pdf'
            };

            const result = exportQuerySchema.safeParse(invalidQuery);
            expect(result.success).toBe(false);
        });

        it('should transform string IDs to numbers', () => {
            const query = {
                customerId: '123',
                customerRepId: '456'
            };

            const result = exportQuerySchema.safeParse(query);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.customerId).toBe(123);
                expect(result.data.customerRepId).toBe(456);
            }
        });

        it('should reject non-numeric ID strings', () => {
            const invalidQuery = {
                customerId: 'abc'
            };

            const result = exportQuerySchema.safeParse(invalidQuery);
            expect(result.success).toBe(false);
        });
    });
});
