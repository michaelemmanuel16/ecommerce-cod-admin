import { Response } from 'express';
import { AuthRequest } from '../types';
import { GLAccountService } from '../services/glAccountService';
import { getLedgerHealth } from '../services/ledgerCheckService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

/**
 * GET /api/financial/health
 * GL balance integrity and journal activity (as before), plus the last order-versus-ledger run and its open gaps (M1-T28).
 */
export const getFinancialHealth = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [balanceReport, journalCount, ledgerCheck] = await Promise.all([
      GLAccountService.verifyAllAccountBalances(),
      prisma.journalEntry.count({ where: { createdAt: { gte: twentyFourHoursAgo } } }),
      getLedgerHealth(),
    ]);

    res.json({
      balanceIntegrity: {
        totalAccounts: balanceReport.totalAccounts,
        unbalancedCount: balanceReport.unbalanced.length,
        maxDifference: balanceReport.maxDifference.toFixed(4),
        isHealthy: balanceReport.unbalanced.length === 0,
        unbalanced: balanceReport.unbalanced.map(u => ({
          accountId: u.accountId,
          code: u.code,
          difference: u.difference.toFixed(4)
        }))
      },
      journalActivity: {
        last24Hours: journalCount
      },
      ledgerCheck,
    });
  } catch (error) {
    logger.error('Failed to fetch financial health', { error });
    res.status(500).json({ message: 'Failed to fetch financial health' });
  }
};
