import { Response } from 'express';
import { AuthRequest } from '../types';
import * as transfers from '../services/transferService';

/** The signed-in user as the transfer service sees them. */
const actorOf = (req: AuthRequest): transfers.TransferActor => ({ id: req.user!.id, role: req.user!.role });

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
