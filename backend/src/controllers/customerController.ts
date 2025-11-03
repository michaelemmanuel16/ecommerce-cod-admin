import { Response } from 'express';
import { AuthRequest } from '../types';
import customerService from '../services/customerService';

export const getAllCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, area, page = 1, limit = 20 } = req.query;

    const result = await customerService.getAllCustomers({
      search: search as string | undefined,
      area: area as string | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const createCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customerData = req.body;
    const customer = await customerService.createCustomer(customerData);
    res.status(201).json({ customer });
  } catch (error) {
    throw error;
  }
};

export const getCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const customer = await customerService.getCustomerById(id);
    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const customer = await customerService.updateCustomer(id, updateData);
    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await customerService.deleteCustomer(id);
    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const updateCustomerTags = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { tags } = req.body;
    const customer = await customerService.updateCustomerTags(id, tags);
    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const getCustomerAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const analytics = await customerService.getCustomerAnalytics(id);
    res.json({ analytics });
  } catch (error) {
    throw error;
  }
};
