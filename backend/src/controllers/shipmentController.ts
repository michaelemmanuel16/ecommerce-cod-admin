import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import * as Money from '../utils/money';


const SHIPMENT_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

function computeTotalCost(unitCost: Money.Money, quantity: number, shippingCost: Money.Money, customsDuties: Money.Money, otherCosts: Money.Money): Money.Money {
  return Money.roundHalfUp(Money.sum([Money.mul(unitCost, quantity), shippingCost, customsDuties, otherCosts]), 4);
}

/** Money from request input. Empty or invalid input is zero. */
function moneyInput(value: unknown): Money.Money {
  return Money.tryParse(value) ?? Money.ZERO;
}

/** Request input when sent, else the stored value. */
function moneyOr(value: unknown, stored: Money.MoneyInput): Money.Money {
  return value !== undefined ? moneyInput(value) : Money.parse(stored);
}

export const listShipments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {

    const { status, productId } = req.query;

    const where: Prisma.InventoryShipmentWhereInput = {

    };
    if (status && (status === 'pending' || status === 'arrived')) {
      where.status = status;
    }
    if (productId) {
      where.productId = parseInt(productId as string);
    }

    const shipments = await prisma.inventoryShipment.findMany({
      where,
      include: SHIPMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    res.json(shipments);
  } catch (error) {
    logger.error('Failed to list shipments:', error);
    res.status(500).json({ error: 'Failed to list shipments' });
  }
};

export const createShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {

    const { productId, supplier, quantity, unitCost, shippingCost, customsDuties, otherCosts, expectedArrivalDate, notes } = req.body;

    if (!productId || !quantity || quantity < 1) {
      res.status(400).json({ error: 'Product and quantity (>= 1) are required' });
      return;
    }

    const product = await prisma.product.findUnique({
      where: {
        id: productId,
      }
    });
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const uc = moneyInput(unitCost);
    const sc = moneyInput(shippingCost);
    const cd = moneyInput(customsDuties);
    const oc = moneyInput(otherCosts);
    const totalCost = computeTotalCost(uc, quantity, sc, cd, oc);

    const shipment = await prisma.inventoryShipment.create({
      data: {
        productId,
        supplier: supplier || null,
        quantity,
        unitCost: uc,
        shippingCost: sc,
        customsDuties: cd,
        otherCosts: oc,
        totalCost,
        expectedArrivalDate: expectedArrivalDate ? new Date(expectedArrivalDate) : null,
        notes: notes || null,
        createdById: req.user!.id,
  
      },
      include: SHIPMENT_INCLUDE,
    });

    res.status(201).json(shipment);
  } catch (error) {
    logger.error('Failed to create shipment:', error);
    res.status(500).json({ error: 'Failed to create shipment' });
  }
};

export const getShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {

    const { id } = req.params;
    const shipmentId = parseInt(id);
    if (isNaN(shipmentId)) {
      res.status(400).json({ error: 'Invalid shipment ID' });
      return;
    }

    const shipment = await prisma.inventoryShipment.findUnique({
      where: {
        id: shipmentId,
      },
      include: SHIPMENT_INCLUDE,
    });

    if (!shipment) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }

    res.json(shipment);
  } catch (error) {
    logger.error('Failed to get shipment:', error);
    res.status(500).json({ error: 'Failed to get shipment' });
  }
};

export const updateShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {

    const { id } = req.params;
    const shipmentId = parseInt(id);
    if (isNaN(shipmentId)) {
      res.status(400).json({ error: 'Invalid shipment ID' });
      return;
    }

    const shipment = await prisma.inventoryShipment.findUnique({
      where: {
        id: shipmentId,
      }
    });
    if (!shipment) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    if (shipment.status !== 'pending') {
      res.status(400).json({ error: 'Cannot edit an arrived shipment' });
      return;
    }

    const { supplier, quantity, unitCost, shippingCost, customsDuties, otherCosts, expectedArrivalDate, notes } = req.body;

    const qty = quantity !== undefined ? quantity : shipment.quantity;
    const uc = moneyOr(unitCost, shipment.unitCost);
    const sc = moneyOr(shippingCost, shipment.shippingCost);
    const cd = moneyOr(customsDuties, shipment.customsDuties);
    const oc = moneyOr(otherCosts, shipment.otherCosts);
    const totalCost = computeTotalCost(uc, qty, sc, cd, oc);

    const updated = await prisma.inventoryShipment.update({
      where: {
        id: shipmentId,
  
      },
      data: {
        supplier: supplier !== undefined ? (supplier || null) : undefined,
        quantity: qty,
        unitCost: uc,
        shippingCost: sc,
        customsDuties: cd,
        otherCosts: oc,
        totalCost,
        expectedArrivalDate: expectedArrivalDate !== undefined
          ? (expectedArrivalDate ? new Date(expectedArrivalDate) : null)
          : undefined,
        notes: notes !== undefined ? (notes || null) : undefined,
      },
      include: SHIPMENT_INCLUDE,
    });

    res.json(updated);
  } catch (error) {
    logger.error('Failed to update shipment:', error);
    res.status(500).json({ error: 'Failed to update shipment' });
  }
};

export const deleteShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {

    const { id } = req.params;
    const shipmentId = parseInt(id);
    if (isNaN(shipmentId)) {
      res.status(400).json({ error: 'Invalid shipment ID' });
      return;
    }

    const shipment = await prisma.inventoryShipment.findUnique({
      where: {
        id: shipmentId,
      }
    });
    if (!shipment) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    if (shipment.status !== 'pending') {
      res.status(409).json({ error: 'Cannot delete an arrived shipment — it has GL entries and stock changes' });
      return;
    }

    await prisma.inventoryShipment.delete({
      where: {
        id: shipmentId,
  
      }
    });
    res.json({ message: 'Shipment deleted' });
  } catch (error) {
    logger.error('Failed to delete shipment:', error);
    res.status(500).json({ error: 'Failed to delete shipment' });
  }
};
