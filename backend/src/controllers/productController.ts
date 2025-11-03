import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

export const getAllProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, category, isActive, page = 1, limit = 20 } = req.query;

    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { sku: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (category) where.category = category;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const skip = (Number(page) - 1) * Number(limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.product.count({ where })
    ]);

    res.json({
      products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const productData = req.body;

    const existingProduct = await prisma.product.findUnique({
      where: { sku: productData.sku }
    });

    if (existingProduct) {
      throw new AppError('Product with this SKU already exists', 400);
    }

    const product = await prisma.product.create({
      data: productData
    });

    res.status(201).json({ product });
  } catch (error) {
    throw error;
  }
};

export const getProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const productId = parseInt(id, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    res.json({ product });
  } catch (error) {
    throw error;
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const productId = parseInt(id, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    const updateData = req.body;

    const product = await prisma.product.update({
      where: { id: productId },
      data: updateData
    });

    res.json({ product });
  } catch (error) {
    throw error;
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const productId = parseInt(id, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    await prisma.product.update({
      where: { id: productId },
      data: { isActive: false }
    });

    res.json({ message: 'Product deactivated successfully' });
  } catch (error) {
    throw error;
  }
};

export const updateProductStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const productId = parseInt(id, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    const { stockQuantity } = req.body;

    const product = await prisma.product.update({
      where: { id: productId },
      data: { stockQuantity }
    });

    res.json({ product });
  } catch (error) {
    throw error;
  }
};

export const getLowStockProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        stockQuantity: {
          lte: prisma.product.fields.lowStockThreshold
        }
      },
      orderBy: { stockQuantity: 'asc' }
    });

    res.json({ products });
  } catch (error) {
    throw error;
  }
};
