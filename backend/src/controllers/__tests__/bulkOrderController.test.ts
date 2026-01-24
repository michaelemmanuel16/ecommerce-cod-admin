import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response } from 'express';
import * as bulkOrderController from '../../controllers/bulkOrderController';
import orderService from '../../services/orderService';
import { OrderStatus } from '@prisma/client';

// Mock the orderService
jest.mock('../../services/orderService');

describe('Bulk Order Controller', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let jsonMock: jest.Mock;
    let statusMock: jest.Mock;
    let sendMock: jest.Mock;
    let setHeaderMock: jest.Mock;

    beforeEach(() => {
        jsonMock = jest.fn();
        sendMock = jest.fn();
        statusMock = jest.fn(() => ({ json: jsonMock, send: sendMock }));
        setHeaderMock = jest.fn();

        mockRes = {
            status: statusMock as any,
            json: jsonMock,
            send: sendMock,
            setHeader: setHeaderMock
        };

        jest.clearAllMocks();
    });

    describe('exportOrders', () => {
        it('should export orders as CSV with valid filters', async () => {
            mockReq = {
                query: {
                    status: 'pending_confirmation',
                    format: 'csv'
                },
                user: { id: 1, role: 'super_admin' }
            } as any;

            const mockOrders = {
                orders: [
                    {
                        id: 1,
                        createdAt: new Date('2026-01-08'),
                        customer: { firstName: 'John', lastName: 'Doe', phoneNumber: '+233123456789', alternatePhone: null },
                        deliveryAddress: '123 Main St',
                        deliveryArea: 'Accra',
                        deliveryState: 'Greater Accra',
                        totalAmount: 250,
                        status: 'pending_confirmation' as OrderStatus,
                        orderItems: [{ quantity: 1, product: { name: 'Product A' } }],
                        customerRep: null,
                        deliveryAgent: null,
                        notes: ''
                    }
                ],
                total: 1,
                page: 1,
                limit: 1000
            };

            (orderService.getAllOrders as jest.Mock).mockResolvedValue(mockOrders);

            await bulkOrderController.exportOrders(mockReq as any, mockRes as Response);

            expect(orderService.getAllOrders).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 500,
                    page: 1
                })
            );
            expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'text/csv');
            expect(setHeaderMock).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('orders_export_'));
        });

        it('should export orders as XLSX when format is xlsx', async () => {
            mockReq = {
                query: {
                    format: 'xlsx'
                },
                user: { id: 1, role: 'super_admin' }
            } as any;

            const mockOrders = {
                orders: [{
                    id: 1,
                    createdAt: new Date('2026-01-08'),
                    customer: { firstName: 'Jane', lastName: 'Smith', phoneNumber: '+233987654321', alternatePhone: null },
                    deliveryAddress: '456 Oak Ave',
                    deliveryArea: 'Kumasi',
                    deliveryState: 'Ashanti',
                    totalAmount: 500,
                    status: 'confirmed' as OrderStatus,
                    orderItems: [{ quantity: 2, product: { name: 'Product B' } }],
                    customerRep: null,
                    deliveryAgent: null,
                    notes: 'Rush order'
                }],
                total: 1,
                page: 1,
                limit: 1000
            };

            (orderService.getAllOrders as jest.Mock).mockResolvedValue(mockOrders);

            await bulkOrderController.exportOrders(mockReq as any, mockRes as Response);

            expect(setHeaderMock).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        });

        it('should validate query parameters and return 400 for invalid input', async () => {
            mockReq = {
                query: {
                    startDate: 'invalid-date'
                },
                user: { id: 1, role: 'super_admin' }
            } as any;

            await bulkOrderController.exportOrders(mockReq as any, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Invalid query parameters'
                })
            );
        });

        it('should respect export limit of 500 records', async () => {
            mockReq = {
                query: {},
                user: { id: 1, role: 'super_admin' }
            } as any;

            const mockOrders = [{
                id: 1,
                createdAt: new Date(),
                customer: { firstName: 'John', lastName: 'Doe', phoneNumber: '1234567890', alternatePhone: '' },
                deliveryAddress: '123 Main St',
                deliveryArea: 'Downtown',
                deliveryState: 'CA',
                orderItems: [{ product: { name: 'Product 1' }, quantity: 1 }],
                totalAmount: 100,
                status: 'pending_confirmation',
                customerRep: null,
                deliveryAgent: null,
                notes: ''
            }];

            (orderService.getAllOrders as jest.Mock).mockResolvedValue({
                orders: mockOrders,
                pagination: {
                    total: 1,
                    page: 1,
                    limit: 500,
                    totalPages: 1
                }
            });

            await bulkOrderController.exportOrders(mockReq as any, mockRes as Response);

            expect(orderService.getAllOrders).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 500
                })
            );
        });

        it('should return 404 when no orders match export criteria', async () => {
            mockReq = {
                query: {},
                user: { id: 1, role: 'super_admin' }
            } as any;

            (orderService.getAllOrders as jest.Mock).mockResolvedValue({
                orders: [],
                pagination: {
                    total: 0,
                    page: 1,
                    limit: 500,
                    totalPages: 0
                }
            });

            await bulkOrderController.exportOrders(mockReq as any, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith({ message: 'No orders found matching the criteria' });
        });
    });

    describe('uploadOrders', () => {
        it('should return 400 if no file is uploaded', async () => {
            mockReq = {
                file: undefined,
                user: { id: 1 }
            } as any;

            await bulkOrderController.uploadOrders(mockReq as any, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith({ message: 'No file uploaded' });
        });

        it('should return 400 for unsupported file format', async () => {
            mockReq = {
                file: {
                    originalname: 'orders.txt',
                    buffer: Buffer.from('test')
                },
                user: { id: 1 }
            } as any;

            await bulkOrderController.uploadOrders(mockReq as any, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith({ message: 'Unsupported file format' });
        });

        it('should return 400 if file size exceeds limit', async () => {
            mockReq = {
                file: {
                    originalname: 'orders.csv',
                    buffer: Buffer.from('test'),
                    size: 11 * 1024 * 1024 // 11MB
                },
                user: { id: 1 }
            } as any;

            await bulkOrderController.uploadOrders(mockReq as any, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('File too large')
                })
            );
        });

        it('should truncate overly long names during import', async () => {
            const longName = 'A'.repeat(200);
            const csvContent = `CUSTOMER NAME,PHONE NUMBER,CUSTOMER ADDRESS,REGION,PRICE,QUANTITY
${longName},+233123456789,123 Main St,Accra,250,1`;

            mockReq = {
                file: {
                    originalname: 'orders.csv',
                    buffer: Buffer.from(csvContent),
                    size: csvContent.length
                },
                user: { id: 1 }
            } as any;

            (orderService.bulkImportOrders as jest.Mock).mockResolvedValue({ success: 1 });

            await bulkOrderController.uploadOrders(mockReq as any, mockRes as Response);

            expect(orderService.bulkImportOrders).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({
                        customerFirstName: 'A'.repeat(100)
                    })
                ]),
                expect.any(Number),
                expect.any(Map),
                expect.any(Map),
                false
            );
        });

        it('should successfully import valid CSV file', async () => {
            const csvContent = `CUSTOMER NAME,PHONE NUMBER,CUSTOMER ADDRESS,REGION,PRICE,QUANTITY
John Doe,+233123456789,123 Main St,Accra,250,1`;

            mockReq = {
                file: {
                    originalname: 'orders.csv',
                    buffer: Buffer.from(csvContent)
                },
                user: { id: 1 }
            } as any;

            const mockResults = {
                success: 1,
                failed: 0,
                duplicates: 0,
                errors: []
            };

            (orderService.bulkImportOrders as jest.Mock).mockResolvedValue(mockResults);

            await bulkOrderController.uploadOrders(mockReq as any, mockRes as Response);

            expect(orderService.bulkImportOrders).toHaveBeenCalled();
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    results: mockResults
                })
            );
        });

        it('should return 400 if no valid orders found in file', async () => {
            const csvContent = `CUSTOMER NAME,PHONE NUMBER
Invalid,Data`;

            mockReq = {
                file: {
                    originalname: 'orders.csv',
                    buffer: Buffer.from(csvContent)
                },
                user: { id: 1 }
            } as any;

            await bulkOrderController.uploadOrders(mockReq as any, mockRes as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith({ message: 'No valid orders found in file' });
        });
    });
});
