import { Response } from 'express';
import { AuthRequest } from '../types';
import * as shipments from '../services/shipmentService';
import { actorOf } from '../utils/stockActor';


/** GET /api/shipments */
export const listShipments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, productId } = req.query;
  res.json(await shipments.listShipments({
    status: typeof status === 'string' ? status : undefined,
    productId: productId ? Number(productId) : undefined,
  }));
};

/** GET /api/shipments/summary: the three tiles */
export const getSummary = async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(await shipments.summary());
};

/** GET /api/shipments/:id */
export const getShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await shipments.getShipment(Number(req.params.id)));
};

/** POST /api/shipments */
export const createShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  res.status(201).json(await shipments.createShipment(actorOf(req), req.body));
};

/** PATCH /api/shipments/:id (pending only) */
export const updateShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await shipments.updateShipment(actorOf(req), Number(req.params.id), req.body));
};

/** DELETE /api/shipments/:id (pending only) */
export const deleteShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  await shipments.deleteShipment(actorOf(req), Number(req.params.id));
  res.json({ message: 'Shipment deleted' });
};

/** POST /api/shipments/:id/receive (F-606) */
export const receiveShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await shipments.receiveShipment(actorOf(req), Number(req.params.id), req.body));
};

/** POST /api/shipments/:id/claim (F-608) */
export const settleClaim = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await shipments.settleClaim(actorOf(req), Number(req.params.id), req.body));
};
