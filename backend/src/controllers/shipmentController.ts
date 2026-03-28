import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { GLAutomationService } from '../services/glAutomationService';
import logger from '../utils/logger';

const SHIPMENT_INCLUDE = {
  product: { select: { id: true, name: true, sku: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

function computeTotalCost(unitCost: number, quantity: number, shippingCost: number, customsDuties: number, otherCosts: number): number {
  return (unitCost * quantity) + shippingCost + customsDuties + otherCosts;
}

export const listShipments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, productId } = req.query;

    const where: Prisma.InventoryShipmentWhereInput = {};
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

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const uc = parseFloat(unitCost) || 0;
    const sc = parseFloat(shippingCost) || 0;
    const cd = parseFloat(customsDuties) || 0;
    const oc = parseFloat(otherCosts) || 0;
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
      where: { id: shipmentId },
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

    const shipment = await prisma.inventoryShipment.findUnique({ where: { id: shipmentId } });
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
    const uc = unitCost !== undefined ? parseFloat(unitCost) : Number(shipment.unitCost);
    const sc = shippingCost !== undefined ? parseFloat(shippingCost) : Number(shipment.shippingCost);
    const cd = customsDuties !== undefined ? parseFloat(customsDuties) : Number(shipment.customsDuties);
    const oc = otherCosts !== undefined ? parseFloat(otherCosts) : Number(shipment.otherCosts);
    const totalCost = computeTotalCost(uc, qty, sc, cd, oc);

    const updated = await prisma.inventoryShipment.update({
      where: { id: shipmentId },
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

export const markArrived = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const shipmentId = parseInt(id);
    if (isNaN(shipmentId)) {
      res.status(400).json({ error: 'Invalid shipment ID' });
      return;
    }

    // Pre-check outside transaction
    const existing = await prisma.inventoryShipment.findUnique({ where: { id: shipmentId } });
    if (!existing) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    if (existing.status !== 'pending') {
      res.status(400).json({ error: 'Shipment has already arrived' });
      return;
    }

    const result = await prisma.$transaction(async (txClient) => {
      // Cast needed: Prisma interactive transaction types don't align with extension types
      const tx = txClient as any;

      // Atomic status flip — prevents double-processing under concurrent requests
      const flipped = await tx.inventoryShipment.updateMany({
        where: { id: shipmentId, status: 'pending' },
        data: { status: 'arrived', arrivedAt: new Date() },
      });
      if (flipped.count === 0) {
        throw new Error('Shipment not found or already arrived');
      }

      // Re-read with product for GL entry
      const shipment = await tx.inventoryShipment.findUnique({
        where: { id: shipmentId },
        include: { product: true },
      });

      // 1. Increment product stock + update COGS using weighted average
      const currentStock = shipment.product.stockQuantity;
      const currentCogs = Number(shipment.product.cogs) || 0;
      const newQty = shipment.quantity;
      const landedCostPerUnit = Number(shipment.totalCost) / newQty;
      const weightedCogs = currentStock + newQty > 0
        ? ((currentStock * currentCogs) + (newQty * landedCostPerUnit)) / (currentStock + newQty)
        : landedCostPerUnit;

      await tx.product.update({
        where: { id: shipment.productId },
        data: {
          stockQuantity: { increment: newQty },
          cogs: weightedCogs,
        },
      });

      // 2. Create GL entry (DR Inventory, CR Cash in Hand)
      const glEntry = await GLAutomationService.createInventoryPurchaseEntry(
        tx,
        shipment,
        req.user!.id
      );

      // 3. Link GL entry to shipment
      const updated = await tx.inventoryShipment.update({
        where: { id: shipmentId },
        data: { glJournalEntryId: glEntry.id },
        include: SHIPMENT_INCLUDE,
      });

      return updated;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    res.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('already arrived') || msg.includes('not found')) {
      res.status(409).json({ error: msg });
      return;
    }
    logger.error('Failed to mark shipment as arrived:', error);
    res.status(500).json({ error: 'Failed to mark shipment as arrived' });
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

    const shipment = await prisma.inventoryShipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) {
      res.status(404).json({ error: 'Shipment not found' });
      return;
    }
    if (shipment.status !== 'pending') {
      res.status(409).json({ error: 'Cannot delete an arrived shipment — it has GL entries and stock changes' });
      return;
    }

    await prisma.inventoryShipment.delete({ where: { id: shipmentId } });
    res.json({ message: 'Shipment deleted' });
  } catch (error) {
    logger.error('Failed to delete shipment:', error);
    res.status(500).json({ error: 'Failed to delete shipment' });
  }
};
