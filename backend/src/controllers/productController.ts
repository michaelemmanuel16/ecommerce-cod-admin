import { Response } from 'express';
import { AuthRequest } from '../types';
import * as products from '../services/productService';
import { canSeeCost } from '../utils/costAccess';

const role = (req: AuthRequest) => req.user?.role;

export const getAllProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  const { search, category, isActive, tab, month, page = 1, limit = 20 } = req.query;
  const result = await products.listProducts({
    search: search as string | undefined, category: category as string | undefined,
    isActive: isActive === undefined ? undefined : isActive === 'true',
    tab: tab as products.TabName | undefined, month: month as string | undefined,
    page: Number(page), limit: Number(limit),
  });
  res.json({ ...result, products: result.products.map((p) => products.forRole(role(req), p)) });
};

export const getProductsSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  // The tiles hold the average margin: cost-role only
  if (!canSeeCost(role(req))) {
    res.status(403).json({ error: 'You do not have access to cost figures' });
    return;
  }
  res.json(await products.productsSummary(req.query.month as string | undefined));
};

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  const product = await products.createProduct(req.user!.id, req.body);
  res.status(201).json({ product });
};

export const getProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ product: products.forRole(role(req), await products.getProduct(Number(req.params.id), req.query.includeArchived === 'true')) });
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ product: await products.updateProduct(Number(req.params.id), req.body) });
};

export const archiveProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await products.archiveProduct(Number(req.params.id)));
};

export const restoreProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ product: await products.restoreProduct(Number(req.params.id)) });
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  await products.deleteProduct(Number(req.params.id));
  res.json({ message: 'Product deactivated successfully' });
};

export const getLowStockProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ products: (await products.lowStockProducts()).map((p) => products.forRole(role(req), p)) });
};
