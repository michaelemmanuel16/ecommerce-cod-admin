import { Response } from 'express';
import { AuthRequest } from '../types';
import fileType from 'file-type';
import orderService from '../services/orderService';
import { checkReport, PreparedImport, prepareImport, problemsCsv } from '../services/orderImportService';
import { auditService } from '../services/auditService';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';
import { AppError } from '../middleware/errorHandler';
import { clearCache } from '../middleware/cache';
import logger from '../utils/logger';

/** Reads and checks the uploaded file. Nothing is saved (F-319 step 1). */
async function prepare(req: AuthRequest): Promise<PreparedImport> {
    const file = req.file;
    if (!file) throw new AppError('No file uploaded', 400);
    if (file.size > BULK_ORDER_CONFIG.MAX_FILE_SIZE) {
        throw new AppError(`File too large. The limit is ${BULK_ORDER_CONFIG.MAX_FILE_SIZE / (1024 * 1024)} MB`, 413);
    }

    const extension = file.originalname.split('.').pop()?.toLowerCase();
    if (extension === 'xlsx' || extension === 'xls') {
        try {
            const detected = await fileType.fromBuffer(file.buffer);
            const valid = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
            if (!detected || !valid.includes(detected.mime)) {
                throw new AppError('Invalid Excel file format detected. File may be corrupted or renamed.', 400);
            }
        } catch (error) {
            if (error instanceof AppError) throw error;
            logger.warn('File type validation failed', { error });
            // Continue - rely on extension validation
        }
    }
    return prepareImport(file);
}

/** POST /api/orders/upload/validate: counts, ready rows and per-row problems. Saves nothing. */
export const validateUpload = async (req: AuthRequest, res: Response): Promise<void> => {
    res.json(checkReport(await prepare(req)));
};

/** POST /api/orders/upload: imports the ready rows through the state machine (F-319 step 2). */
export const uploadOrders = async (req: AuthRequest, res: Response): Promise<void> => {
    const prepared = await prepare(req);
    const report = checkReport(prepared);
    if (prepared.ready.length === 0 && prepared.duplicates.length === 0) {
        res.status(400).json({ message: 'No valid orders found in file', ...report });
        return;
    }

    const results = await orderService.bulkImportOrders(
        prepared.ready.map((r) => r.data!),
        req.user?.id,
        prepared.repMap,
        prepared.agentMap,
        prepared.ready.length > 10, // silent mode for large imports prevents event storms
        // Workflows (and the messages they send) run for the import only when the uploader asks
        { runWorkflows: req.body?.runWorkflows === 'true' }
    );
    clearCache('/api/analytics');

    // Rows the file check rejected and rows that failed on save go in one problems file
    const failedOnSave = results.errors.map((e) => ({ row: e.order.sourceRow, message: e.error }));
    const saveProblems = failedOnSave.flatMap((f) => {
        const row = prepared.checked.find((c) => c.row === f.row);
        return row ? [{ cells: row.cells, problems: [f.message] }] : [];
    });
    const csv = problemsCsv(prepared.sheet.headers, [...prepared.problems, ...saveProblems]);

    await auditService.record({
        actorId: req.user?.id,
        actorKind: 'person',
        channel: 'app',
        action: 'import_orders',
        resource: 'order',
        metadata: {
            fileName: prepared.fileName,
            rows: report.total,
            ready: report.ready,
            needFix: report.needFix,
            successful: results.success,
            failed: results.failed,
            duplicates: results.duplicates + report.duplicates,
        },
    });

    res.json({
        results: { ...results, duplicates: results.duplicates + report.duplicates },
        total: report.total,
        needFix: report.needFix,
        note: report.note,
        problems: report.problems,
        problemsCsv: prepared.problems.length + saveProblems.length ? csv : null,
    });
};
