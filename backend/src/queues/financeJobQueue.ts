/**
 * Finance background jobs (M5-T29): a general ledger export over the line limit (F-921) and a health check that
 * takes over 30 seconds (F-931). `enqueueFinanceJob` returns a job id; `getFinanceJob` reads its state.
 * A finished export is a file under the OS temp folder, one folder per tenant; files older than a day are removed
 * when the next export starts. In tests there is no Redis: the same processors run in this process, right away.
 */
import Bull from 'bull';
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import { streamExport, ExportFormat } from '../services/exportStream';
import { buildReport, exportFileName, ExportInput } from '../services/financeExportService';
import { runFinanceHealth } from '../services/financeHealthService';

export type FinanceJobName = 'ledger-export' | 'health-check';
export interface FinanceJobData {
  tenantId: string;
  userId: number;
  format?: ExportFormat;
  input?: ExportInput;
}
export type FinanceJobStatus = 'queued' | 'running' | 'done' | 'failed';
export interface FinanceJobView {
  id: string;
  name: FinanceJobName;
  tenantId: string;
  status: FinanceJobStatus;
  result?: any;
  error?: string;
}

const EXPORT_DIR = path.join(os.tmpdir(), 'codadmin-finance-exports');
const FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const exportFolder = (tenantId: string) => path.join(EXPORT_DIR, tenantId);

async function removeOldFiles(dir: string) {
  for (const f of await fs.promises.readdir(dir).catch(() => [] as string[])) {
    const file = path.join(dir, f);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > FILE_MAX_AGE_MS) await fs.promises.rm(file, { force: true });
  }
}

/** Write the ledger export to a file with the same streaming writer the download uses. */
async function writeLedgerFile(jobId: string, data: FinanceJobData) {
  const format = data.format ?? 'csv';
  const dir = exportFolder(data.tenantId);
  await fs.promises.mkdir(dir, { recursive: true });
  await removeOldFiles(dir);
  const file = path.join(dir, `${jobId}.${format}`);
  const filename = `${exportFileName('general-ledger', data.input ?? {})}.${format}`;

  const out = fs.createWriteStream(file);
  const finished = new Promise<void>((resolve, reject) => {
    out.once('error', reject);
    out.once('close', () => (out.writableFinished ? resolve() : reject(new Error('The export file was not written'))));
  });
  // streamExport writes to a response; a file stream has the same write/end/destroy calls, only setHeader is missing.
  const sink = Object.assign(out, { setHeader: () => undefined }) as unknown as import('express').Response;
  const { columns, batches } = await buildReport('general-ledger', data.input ?? {});
  let rows = 0;
  async function* counted() { for await (const b of batches) { rows += b.length; yield b; } }
  await streamExport(sink, { format, filename: filename.replace(/\.(csv|xlsx)$/, ''), columns, batches: counted() });
  await finished;
  return { filename, file, rows };
}

type Processor = (job: { id: string | number; data: FinanceJobData }) => Promise<any>;
const processors: Record<FinanceJobName, Processor> = {
  'ledger-export': (job) => runInTenant(job.data.tenantId, () => writeLedgerFile(String(job.id), job.data)),
  'health-check': (job) => runInTenant(job.data.tenantId, () => runFinanceHealth()),
};

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

const isTest = process.env.NODE_ENV === 'test';
export const financeJobQueue: Bull.Queue<FinanceJobData> | null = isTest ? null : new Bull('finance-jobs', { redis: redisConfig });
if (financeJobQueue) {
  for (const name of Object.keys(processors) as FinanceJobName[]) financeJobQueue.process(name, (job) => processors[name](job));
  financeJobQueue.on('failed', (job, err) => logger.error(`Finance job ${job?.id} failed:`, err));
}

// Test mode: jobs run in this process
const memory = new Map<string, FinanceJobView>();
let memorySeq = 0;

export async function enqueueFinanceJob(name: FinanceJobName, data: FinanceJobData): Promise<string> {
  if (financeJobQueue) {
    const job = await financeJobQueue.add(name, data, { removeOnComplete: 200, removeOnFail: 200 });
    return String(job.id);
  }
  const id = String(++memorySeq);
  const view: FinanceJobView = { id, name, tenantId: data.tenantId, status: 'queued' };
  memory.set(id, view);
  setImmediate(() => {
    view.status = 'running';
    processors[name]({ id, data }).then(
      (result) => { view.result = result; view.status = 'done'; },
      (error) => { view.error = String(error?.message ?? error); view.status = 'failed'; },
    );
  });
  return id;
}

export async function getFinanceJob(id: string): Promise<FinanceJobView | null> {
  if (!financeJobQueue) return memory.get(id) ?? null;
  const job = await financeJobQueue.getJob(id);
  if (!job) return null;
  const state = await job.getState();
  const status: FinanceJobStatus = state === 'completed' ? 'done' : state === 'failed' ? 'failed' : state === 'active' ? 'running' : 'queued';
  return { id: String(job.id), name: job.name as FinanceJobName, tenantId: job.data.tenantId, status, result: job.returnvalue ?? undefined, error: job.failedReason || undefined };
}
