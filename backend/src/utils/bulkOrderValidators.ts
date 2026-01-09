import { z } from 'zod';
import { OrderStatus } from '@prisma/client';

// Phone number validation (international format with proper validation)
const phoneNumberSchema = z.string()
    .min(10, 'Phone number must be at least 10 digits')
    .max(20, 'Phone number must be at most 20 characters')
    .regex(/^\+?[0-9]{1,4}?[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}$/, 'Invalid phone number format')
    .refine((val) => {
        // Extract only digits to validate minimum length
        const digits = val.replace(/\D/g, '');
        return digits.length >= 10 && digits.length <= 15;
    }, 'Phone number must contain 10-15 digits');

// Order status enum validation
const orderStatusSchema = z.nativeEnum(OrderStatus).optional();

// Bulk import order data schema
export const bulkImportOrderSchema = z.object({
    customerPhone: phoneNumberSchema,
    customerFirstName: z.string().min(1, 'First name is required').max(100),
    customerLastName: z.string().max(100).optional(),
    customerAlternatePhone: phoneNumberSchema.optional().or(z.literal('')),
    subtotal: z.number().positive('Subtotal must be positive'),
    totalAmount: z.number().positive('Total amount must be positive'),
    deliveryAddress: z.string().min(5, 'Address must be at least 5 characters').max(500),
    deliveryState: z.string().min(2, 'State is required').max(100),
    deliveryArea: z.string().min(2, 'Area is required').max(100),
    productName: z.string().max(200).optional().or(z.literal('')),
    quantity: z.number().int().positive().optional(),
    unitPrice: z.number().positive().optional(),
    status: orderStatusSchema,
    notes: z.string().max(1000).optional().or(z.literal(''))
});

// Schema for export query parameters
export const exportQuerySchema = z.object({
    status: z.union([
        z.nativeEnum(OrderStatus),
        z.array(z.nativeEnum(OrderStatus))
    ]).optional(),
    customerId: z.string().regex(/^\d+$/).transform(Number).optional(),
    customerRepId: z.string().regex(/^\d+$/).transform(Number).optional(),
    deliveryAgentId: z.string().regex(/^\d+$/).transform(Number).optional(),
    area: z.string().max(100).optional(),
    startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    search: z.string().max(200).optional(),
    format: z.enum(['csv', 'xlsx']).default('csv')
});

export type BulkImportOrderData = z.infer<typeof bulkImportOrderSchema>;
export type ExportQueryParams = z.infer<typeof exportQuerySchema>;
