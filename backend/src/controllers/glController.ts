import { Response } from 'express';
import { AuthRequest } from '../types';
import glService from '../services/glService';
import { AccountType } from '@prisma/client';

export const getAllAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accountType, isActive, page = 1, limit = 50 } = req.query;

    const result = await glService.getAllAccounts({
      accountType: accountType as AccountType | undefined,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await glService.getAccountById(id);
    res.json({ account });
  } catch (error) {
    throw error;
  }
};

export const createAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { code, name, description, accountType, normalBalance, parentId } = req.body;

    const account = await glService.createAccount({
      code,
      name,
      description,
      accountType,
      normalBalance,
      parentId: parentId ? parseInt(parentId, 10) : undefined
    }, req.user);

    res.status(201).json({ account });
  } catch (error) {
    throw error;
  }
};

export const updateAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, parentId } = req.body;

    const account = await glService.updateAccount(id, {
      name,
      description,
      parentId: parentId !== undefined ? (parentId ? parseInt(parentId, 10) : null) : undefined
    }, req.user);

    res.json({ account });
  } catch (error) {
    throw error;
  }
};

export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await glService.deleteAccount(id, req.user);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    throw error;
  }
};

export const deactivateAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await glService.toggleAccountStatus(id, false, req.user);
    res.json({ account, message: 'Account deactivated successfully' });
  } catch (error) {
    throw error;
  }
};

export const activateAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const account = await glService.toggleAccountStatus(id, true, req.user);
    res.json({ account, message: 'Account activated successfully' });
  } catch (error) {
    throw error;
  }
};
