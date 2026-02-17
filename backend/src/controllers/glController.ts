import { Response } from 'express';
import { AuthRequest } from '../types';
import glService from '../services/glService';
import { AccountType, JournalSourceType } from '@prisma/client';

export const getAllAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { accountType, isActive, page = 1, limit = 50, startDate, endDate } = req.query;

    const result = await glService.getAllAccounts({
      accountType: accountType as AccountType | undefined,
      isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
      page: Number(page),
      limit: Number(limit),
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined
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

// Journal Entry Controllers

export const createJournalEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { entryDate, description, sourceType, sourceId, transactions } = req.body;

    const entry = await glService.createJournalEntry({
      entryDate,
      description,
      sourceType: sourceType as JournalSourceType,
      sourceId: sourceId ? parseInt(sourceId, 10) : undefined,
      transactions
    }, req.user);

    res.status(201).json({ entry });
  } catch (error) {
    throw error;
  }
};

export const getJournalEntries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      sourceType,
      sourceId,
      isVoided,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const result = await glService.getJournalEntries({
      sourceType: sourceType as JournalSourceType | undefined,
      sourceId: sourceId ? parseInt(sourceId as string, 10) : undefined,
      isVoided: isVoided === 'true' ? true : isVoided === 'false' ? false : undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getJournalEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const entry = await glService.getJournalEntryById(id);
    res.json({ entry });
  } catch (error) {
    throw error;
  }
};

export const voidJournalEntry = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { voidReason } = req.body;

    const entry = await glService.voidJournalEntry(id, voidReason, req.user);
    res.json({ entry, message: 'Journal entry voided successfully' });
  } catch (error) {
    throw error;
  }
};

export const getAccountBalance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const balance = await glService.getAccountBalance(id);
    res.json(balance);
  } catch (error) {
    throw error;
  }
};

export const getAccountLedger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { startDate, endDate, page = 1, limit = 100 } = req.query;

    const result = await glService.getAccountLedger(id, {
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const exportAccountLedger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;

    const { csv, filename } = await glService.exportAccountLedgerToCSV(id, {
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  } catch (error) {
    throw error;
  }
};
