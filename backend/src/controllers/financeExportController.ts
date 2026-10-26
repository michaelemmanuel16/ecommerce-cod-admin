import fs from 'fs';
import path from 'path';
import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { getTenantId } from '../utils/tenantContext';
import { readId } from '../utils/kpiRequest';
import { parseScenario } from '../services/finance/cashFlowService';
import { readFormat, streamExport } from '../services/exportStream';
import {
  buildReport, countLedgerLines, exportFileName, ExportInput, ledgerOverLimit, readReport,
} from '../services/financeExportService';
import { enqueueFinanceJob, exportFolder, getFinanceJob } from '../queues/financeJobQueue';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) throw new AppError(`${label} must be a date as YYYY-MM-DD`, 400, 'INVALID_RANGE');
  return value;
};

/**
 * Start a background ledger export and answer 202 with the job id. Used when the ledger is over the line limit.
 * Exported for the per-account ledger export in glController.
 */
export async function startLedgerJob(res: Response, input: ExportInput, format: 'csv' | 'xlsx'): Promise<boolean> {
  if (!(await ledgerOverLimit(input))) return false;
  const lines = await countLedgerLines(input);
  const jobId = await enqueueFinanceJob('ledger-export', { tenantId: getTenantId()!, format, input });
  res.status(202).json({ jobId, status: 'queued', lines, statusUrl: `/api/financial/jobs/${jobId}` });
  return true;
}

/**
 * GET /api/financial/export/:report?format=csv|xlsx&startDate&endDate (also GET /profit-loss/export).
 * A real file for every report. A ledger over the line limit answers 202 with a job id instead.
 */
export const exportFinanceReport = async (req: AuthRequest, res: Response): Promise<void> => {
  const report = readReport(req.params.report ?? 'profit-loss');
  const format = readFormat(req.query.format);
  const input: ExportInput = {
    startDate: dateParam(req.query.startDate, 'startDate'),
    endDate: dateParam(req.query.endDate, 'endDate'),
    accountId: report === 'general-ledger' ? readId(req.query.accountId, 'accountId') : undefined,
    scenario: report === 'cash-flow' ? parseScenario(req.query.scenario) : undefined,
  };
  if (report === 'general-ledger' && await startLedgerJob(res, input, format)) return;
  const { columns, batches } = await buildReport(report, input, req.user);
  await streamExport(res, { format, filename: exportFileName(report, input), columns, batches });
};

/** GET /api/financial/jobs/:id: state of a background job of this tenant. */
export const getFinanceJobStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const job = await getFinanceJob(req.params.id);
  if (!job || job.tenantId !== getTenantId()) throw new AppError('Job not found', 404);
  const result = job.name === 'ledger-export' && job.result
    ? { filename: job.result.filename, rows: job.result.rows, downloadUrl: `/api/financial/jobs/${job.id}/download` }
    : job.result;
  res.json({ id: job.id, name: job.name, status: job.status, result, error: job.error });
};

/** GET /api/financial/jobs/:id/download: the finished export file. */
export const downloadFinanceJob = async (req: AuthRequest, res: Response): Promise<void> => {
  const job = await getFinanceJob(req.params.id);
  if (!job || job.tenantId !== getTenantId() || job.name !== 'ledger-export') throw new AppError('Job not found', 404);
  if (job.status !== 'done' || !job.result?.file) throw new AppError('The export is not ready', 409, 'JOB_NOT_READY');
  // The path comes from our own job record; check it still sits in this tenant's folder.
  const file = path.resolve(job.result.file);
  if (path.dirname(file) !== path.resolve(exportFolder(job.tenantId)) || !fs.existsSync(file)) throw new AppError('The export file has expired. Run the export again.', 410, 'JOB_FILE_GONE');
  res.download(file, job.result.filename);
};
