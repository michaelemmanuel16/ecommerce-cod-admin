import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response } from 'express';
import * as bulkOrderController from '../../controllers/bulkOrderController';
import orderService from '../../services/orderService';

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
                false,
                { runWorkflows: false }
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
