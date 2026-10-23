import { describe, it, expect, jest } from '@jest/globals';
import * as bulkOrderController from '../../controllers/bulkOrderController';

// The row checks, the 2,000-row limit and the import itself are covered by
// __tests__/unit/orderImportService.test.ts and __tests__/integration/ordersImportApi.test.ts.
jest.mock('../../services/orderService');
jest.mock('../../services/orderImportService', () => ({
    ...(jest.requireActual('../../services/orderImportService') as object),
    prepareImport: jest.fn(),
}));

const res: any = { json: jest.fn(), status: jest.fn(() => ({ json: jest.fn() })) };
const req = (file: unknown) => ({ file, user: { id: 1 } }) as any;

describe('Bulk Order Controller file guards', () => {
    it('refuses a request with no file (400)', async () => {
        await expect(bulkOrderController.validateUpload(req(undefined), res)).rejects.toMatchObject({ statusCode: 400, message: 'No file uploaded' });
        await expect(bulkOrderController.uploadOrders(req(undefined), res)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses a file over 10 MB with HTTP 413', async () => {
        const file = { originalname: 'orders.csv', buffer: Buffer.from('x'), size: 11 * 1024 * 1024 };
        await expect(bulkOrderController.validateUpload(req(file), res)).rejects.toMatchObject({ statusCode: 413 });
        await expect(bulkOrderController.uploadOrders(req(file), res)).rejects.toMatchObject({ statusCode: 413 });
    });
});
