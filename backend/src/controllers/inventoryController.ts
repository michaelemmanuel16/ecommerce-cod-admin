import { Response } from 'express';
import { AuthRequest } from '../types';
import * as transfers from '../services/transferService';
import * as counts from '../services/stockCountService';
import * as reads from '../services/inventoryReadService';
import * as locations from '../services/stockLocationService';
import * as exporter from '../services/transferExportService';
import { actorOf } from '../utils/stockActor';

const intQuery = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v));
const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

/** POST /api/inventory/transfers: allocate, transfer between agents, or return (F-654). */
export const createTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  res.status(201).json({ transfer: await transfers.createTransfer(actorOf(req), req.body) });
};

/** POST /api/inventory/transfers/:id/receive */
export const receiveTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ transfer: await transfers.receiveTransfer(actorOf(req), Number(req.params.id), req.body) });
};

/** POST /api/inventory/transfers/:id/resolve */
export const resolveTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ transfer: await transfers.resolveTransfer(actorOf(req), Number(req.params.id), req.body) });
};

/** POST /api/inventory/transfers/:id/cancel */
export const cancelTransfer = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ transfer: await transfers.cancelTransfer(actorOf(req), Number(req.params.id)) });
};

/** POST /api/inventory/adjust (F-655) */
export const adjustStock = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ adjustment: await transfers.adjustStock(actorOf(req), req.body) });
};

/** POST /api/inventory/counts (F-653) */
export const createCount = async (req: AuthRequest, res: Response): Promise<void> => {
  res.status(201).json({ count: await counts.createCount(actorOf(req), req.body) });
};

/** GET /api/inventory/counts?locationId= */
export const listCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  const { locationId, page, limit } = req.query;
  res.json(await counts.listCounts({ locationId: intQuery(locationId), page: intQuery(page) ?? 1, limit: intQuery(limit) ?? 20 }));
};

/** GET /api/inventory/counts/:id */
export const getCount = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ count: await counts.getCount(Number(req.params.id)) });
};

/** POST /api/inventory/counts/:id/lines/:lineId/apply */
export const applyCountLine = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await counts.applyLine(actorOf(req), Number(req.params.id), Number(req.params.lineId), req.body));
};

/** GET /api/inventory/overview (F-652) */
export const overview = async (req: AuthRequest, res: Response): Promise<void> => {
  const { product, type, onlyDifferences } = req.query;
  res.json(await reads.overview({
    productId: intQuery(product), type: text(type) as reads.OverviewFilters['type'], onlyDifferences: onlyDifferences === 'true',
  }));
};

/** GET /api/inventory/levels */
export const levels = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await reads.levels({ locationId: intQuery(req.query.locationId), productId: intQuery(req.query.productId), scopeLocationId: req.scopeLocationId }));
};

/** GET /api/inventory/product/:productId/holders (F-603) */
export const holders = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await reads.holders(Number(req.params.productId)));
};

/** The transfer filters of the list and the export, from the query. */
const transferFilters = (req: AuthRequest) => {
  const q = req.query;
  return {
    type: text(q.type) as reads.TransferFilters['type'], status: text(q.status) as reads.TransferFilters['status'],
    locationId: intQuery(q.locationId), productId: intQuery(q.productId), from: text(q.from), to: text(q.to),
    scopeLocationId: req.scopeLocationId,
  };
};

/** GET /api/inventory/transfers: movement history (F-659). `includeCounts=true` adds the total and the tab counts. */
export const listTransfers = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await reads.transfers({
    ...transferFilters(req), page: intQuery(req.query.page) ?? 1, limit: intQuery(req.query.limit) ?? 20, includeCounts: req.query.includeCounts === 'true',
  }));
};

/** GET /api/inventory/transfers/export.csv: the same filters as the list, all rows (F-659) */
export const exportTransfers = async (req: AuthRequest, res: Response): Promise<void> => {
  const csv = await exporter.exportTransfers({ id: req.user!.id }, transferFilters(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="stock-moves.csv"');
  res.send(csv);
};

/** GET /api/inventory/locations: id, name, type and active flag of every location, for pickers */
export const listLocations = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json({ locations: await locations.listLocations() });
};

/** GET /api/inventory/returns/summary (F-656) */
export const returnsSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await reads.returnsSummary({ from: text(req.query.from), to: text(req.query.to), partnerId: intQuery(req.query.partnerId) }));
};

/** GET /api/inventory/transfers/:id/trail: the audit rows of one transfer */
export const transferTrail = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await reads.transferTrail(Number(req.params.id)));
};

/** POST /api/inventory/locations: set up the own store (F-652) */
export const createOwnStore = async (req: AuthRequest, res: Response): Promise<void> => {
  res.status(201).json({ location: await locations.createOwnStore({ id: req.user!.id }, req.body) });
};
