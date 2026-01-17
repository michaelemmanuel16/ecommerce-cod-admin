import { describe, it, expect } from '@jest/globals';
import { body, validationResult } from 'express-validator';
import { bulkDeleteValidation } from '../../utils/validators';
import { Request, Response } from 'express';

describe('Bulk Delete Validation', () => {
    const runValidation = async (ids: any) => {
        const req = {
            body: { ids }
        } as Request;

        for (const validation of bulkDeleteValidation) {
            await (validation as any).run(req);
        }

        return validationResult(req);
    };

    it('should pass when ids is an array of 1 to 100 numbers', async () => {
        const result = await runValidation([1, 2, 3]);
        expect(result.isEmpty()).toBe(true);
    });

    it('should fail when ids is empty', async () => {
        const result = await runValidation([]);
        expect(result.isEmpty()).toBe(false);
        expect(result.array()[0].msg).toBe('Cannot delete more than 100 orders at once');
    });

    it('should fail when ids length exceeds 100', async () => {
        const ids = Array.from({ length: 101 }, (_, i) => i + 1);
        const result = await runValidation(ids);
        expect(result.isEmpty()).toBe(false);
        expect(result.array()[0].msg).toBe('Cannot delete more than 100 orders at once');
    });

    it('should fail when ids contains non-numbers', async () => {
        const result = await runValidation([1, '2', 3]);
        expect(result.isEmpty()).toBe(false);
        expect(result.array()[0].msg).toBe('All IDs must be numbers');
    });
});
