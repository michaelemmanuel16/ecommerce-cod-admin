import { Parser } from 'json2csv';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, PaymentStatus } from '@prisma/client';
import logger from '../utils/logger';
import { checkResourceOwnership, Requester } from '../utils/authUtils';
import { hasPermission } from '../middleware/auth';
import { getSocketInstance } from '../utils/socketInstance';
import {
  emitExpenseCreated,
  emitExpenseUpdated,
  emitExpenseDeleted,
  emitTransactionDeposited,
  emitTransactionReconciled
} from '../sockets/index';
import { GL_ACCOUNTS, RETIRED_EXPENSE_CODES } from '../config/glAccounts';
import { TRANSACTION_CONFIG } from '../config/transactionConfig';
import { GLAutomationService } from './glAutomationService';
import { getSystemUserId } from './systemUserService';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { roleScope } from '../utils/kpiRequest';
import { isStorageUrl } from '../config/r2';
import { EXPENSE_PAID_FROM, matchExpenseCategory, EXPENSE_CATEGORIES } from '../config/expenseCategories';
import { getStoreTimeZone, kpiWindow, localDate, parseInclusiveBound } from './kpi/dates';
import { deliveredRevenue, revenueScope } from './kpi/revenue';
import { PENDING_STATUSES } from './kpi/pending';
import { OPEN_COLLECTION_STATUSES, outstandingOf } from '../utils/collectionCash';
import agentReconciliationService, { Cover } from './agentReconciliationService';
import { partnerNetCash } from './feeRuleService';

interface DateFilters {
  startDate?: Date;
  endDate?: Date;
}

interface CreateExpenseData {
  category: string;
  amount: Money.MoneyInput;
  description: string;
  expenseDate: Date;
  recordedBy: string;
  receiptUrl?: string;
  paidFrom?: string | null;
}

/** Shown when an expense is dated in a month that has already ended (F-917). The entry is still saved. */
export const CLOSED_MONTH_NOTICE = 'This month is closed; the P&L changes';

/** The list entry for a category, or a 400 that names the list. */
function expenseCategoryOrThrow(input: unknown): string {
  const category = matchExpenseCategory(input);
  if (!category) throw new AppError(`Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`, 400, 'EXPENSE_CATEGORY_INVALID');
  return category;
}

const RECEIPT_EXTENSIONS = 'jpg|jpeg|png|webp|gif|pdf';
const RECEIPT_EXT = new RegExp(`\\.(${RECEIPT_EXTENSIONS})$`, 'i');
/** What POST /api/upload returns without R2: /uploads/<slug>-<ms>-<random>.<ext>. */
const LOCAL_RECEIPT = new RegExp(`^/uploads/[a-z0-9_-]+-\\d+-\\d+\\.(${RECEIPT_EXTENSIONS})$`, 'i');

/** A receipt link is empty, an upload path, or an https address on our own storage. Anything else is a 400 (stored XSS guard). */
function receiptUrlOrThrow(input: unknown): string | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input === 'string') {
    if (LOCAL_RECEIPT.test(input)) return input;
    // The raw text is checked: URL parsing would quietly resolve a ".." segment away.
    if (isStorageUrl(input) && !input.includes('..') && RECEIPT_EXT.test(new URL(input).pathname)) return input;
  }
  throw new AppError('Receipt must be a file uploaded through the receipt upload (JPEG, PNG, WebP, GIF or PDF)', 400, 'EXPENSE_RECEIPT_INVALID');
}

/** `momo`, `bank` or `cash`; null and undefined mean "not given". */
function paidFromOrThrow(input: unknown): (typeof EXPENSE_PAID_FROM)[number] | null {
  if (input === undefined || input === null || input === '') return null;
  if (!(EXPENSE_PAID_FROM as readonly unknown[]).includes(input)) {
    throw new AppError(`Paid from must be one of: ${EXPENSE_PAID_FROM.join(', ')}`, 400, 'EXPENSE_PAID_FROM_INVALID');
  }
  return input as (typeof EXPENSE_PAID_FROM)[number];
}

/** First day of the current store-zone month as YYYY-MM-DD. A date before it is in a closed month. */
export function closedBefore(now: Date = new Date()): string {
  return `${localDate(now, getStoreTimeZone(getTenantId())).slice(0, 7)}-01`;
}

function closedMonthNotice(...dates: Date[]): string | null {
  const zone = getStoreTimeZone(getTenantId());
  const limit = closedBefore();
  return dates.some((d) => localDate(d, zone) < limit) ? CLOSED_MONTH_NOTICE : null;
}

/**
 * The rows of expenses a requester may read and change: every row for a role that holds `expenses:view_all`
 * (the tenant's role matrix decides), the rows they recorded for anyone else. No requester means an internal call.
 */
async function expenseRowScope(requester?: Requester): Promise<Prisma.ExpenseWhereInput> {
  if (!requester || await hasPermission(requester, 'expenses', 'view_all')) return {};
  return { recordedBy: requester.id };
}

/** True when the requester may change this row: a view_all role, or the person who recorded it. */
async function ownsExpense(requester: Requester | undefined, expense: { recordedBy: number | null }): Promise<boolean> {
  const scope = await expenseRowScope(requester);
  return scope.recordedBy === undefined || scope.recordedBy === expense.recordedBy;
}

/** Rows posted by the system (Meta pull, delivery fee, AI) cannot be edited or deleted by hand (F-917). */
function assertExpenseEditable(expense: { source: string }) {
  if (expense.source !== 'manual') {
    throw new AppError('This expense is posted by the system and cannot be edited or deleted by hand', 403, 'EXPENSE_LOCKED');
  }
}

interface CashFlowForecast {
  date: string;
  expectedCollection: Money.Money;
  expectedExpense: Money.Money;
  projectedBalance: Money.Money;
}

interface AgentHolding {
  agent: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  };
  totalCollected: Money.Money;
  orderCount: number;
  OldestCollectionDate: Date;
}

interface TransactionFilters {
  type?: string;
  status?: PaymentStatus;
  page?: number;
  limit?: number;
}

interface ReconcileTransactionData {
  transactionId: string;
  status: PaymentStatus;
  reference?: string;
  notes?: string;
}

interface FinancialStatementAccount {
  id: number;
  code: string;
  name: string;
  balance: Money.Money;
}

interface BalanceSheetData {
  asOfDate: Date;
  assets: {
    accounts: FinancialStatementAccount[];
    total: Money.Money;
  };
  liabilities: {
    accounts: FinancialStatementAccount[];
    total: Money.Money;
  };
  equity: {
    accounts: FinancialStatementAccount[];
    retainedEarnings: Money.Money;
    total: Money.Money;
  };
  totalLiabilitiesAndEquity: Money.Money;
  isBalanced: boolean;
}

interface ProfitLossData {
  startDate: Date;
  endDate: Date;
  revenue: {
    accounts: FinancialStatementAccount[];
    total: Money.Money;
  };
  cogs: {
    accounts: FinancialStatementAccount[];
    total: Money.Money;
  };
  expenses: {
    accounts: FinancialStatementAccount[];
    total: Money.Money;
  };
  grossProfit: Money.Money;
  grossMarginPercentage: number;
  netIncome: Money.Money;
  netMarginPercentage: number;
}

export class FinancialService {
  private forecastCache = new Map<string, { data: CashFlowForecast[]; timestamp: number }>();
  private readonly FORECAST_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Get financial summary. Revenue is the KPI delivered revenue (delivery-date basis, physical plus paid digital,
   * returns leave in their return month). Expenses, digital revenue (GL 4020) and Paystack fees (GL 5060) come from the GL.
   * COD collected and pipeline revenue remain operational metrics from Order/Transaction tables.
   */
  async getFinancialSummary(filters: DateFilters, requester?: Requester) {
    // The controller hands over store-day bounds: endDate is already the last millisecond of its store day.
    const { startDate, endDate } = filters;

    // --- Revenue (KPI layer) ---
    // No dates means all time. The KPI range is [from, to): the end-of-day bound above is inclusive (see kpiWindow).
    const { from, to } = kpiWindow(startDate, endDate);

    // --- GL-based accounting metrics ---
    // Revenue account codes (digital revenue only: physical revenue is the KPI above)
    const revenueAccountCodes = [GL_ACCOUNTS.DIGITAL_REVENUE];
    // Expense account codes (all 5xxx accounts)
    const expenseAccountCodes = [
      GL_ACCOUNTS.COGS,
      GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE,
      GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE,
      ...RETIRED_EXPENSE_CODES, // Aug and Sep agent commission, as booked
      GL_ACCOUNTS.DELIVERY_FEES,
      GL_ACCOUNTS.SALES_REP_COMMISSION,
      GL_ACCOUNTS.PAYSTACK_FEES,
      GL_ACCOUNTS.OPERATING_EXPENSE
    ];

    // Query GL account balances using a single nested relation filter (avoids large IN clause)
    // Role-based scoping: delivery_agent and sales_rep see only their own orders' GL entries
    const [kpiRevenue, glAggregations, accounts] = await Promise.all([
      deliveredRevenue(resolveTenantId(), from, to, revenueScope(roleScope(requester))),
      prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
                journalEntry: {
          isVoided: false,
                    ...(startDate || endDate ? {
            entryDate: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {})
            }
          } : {}),
          ...(requester?.role === 'delivery_agent'
            ? { orders: { some: { deliveryAgentId: requester.id } } }
            : {}),
          ...(requester?.role === 'sales_rep'
            ? { orders: { some: { customerRepId: requester.id } } }
            : {})
        },
        account: {
          code: { in: [...revenueAccountCodes, ...expenseAccountCodes] }
        }
      },
      _sum: {
        debitAmount: true,
        creditAmount: true
      }
    }),
      // Account metadata to map IDs to codes and normal balances
      prisma.account.findMany({
        where: {
          code: { in: [...revenueAccountCodes, ...expenseAccountCodes] }
        },
        select: { id: true, code: true, normalBalance: true, accountType: true }
      }),
    ]);
    const totalRevenue = Money.parse(kpiRevenue.total.value);
    const accountMap = new Map(accounts.map(a => [a.id, a]));

    let digitalRevenue = Money.ZERO;
    let paystackFees = Money.ZERO;
    let totalExpenses = Money.ZERO;

    for (const agg of glAggregations) {
      const account = accountMap.get(agg.accountId);
      if (!account) continue;

      const debit = Money.orZero(agg._sum.debitAmount);
      const credit = Money.orZero(agg._sum.creditAmount);
      const balance = account.normalBalance === 'debit'
        ? Money.sub(debit, credit)
        : Money.sub(credit, debit);

      if (account.code === GL_ACCOUNTS.DIGITAL_REVENUE) {
        digitalRevenue = Money.add(digitalRevenue, balance);
      } else if (account.accountType === 'expense') {
        totalExpenses = Money.add(totalExpenses, balance);
        if (account.code === GL_ACCOUNTS.PAYSTACK_FEES) paystackFees = Money.add(paystackFees, balance);
      }
    }

    // --- Operational metrics (from Order/Transaction tables) ---
    const dateWhere: any = {};
    if (startDate || endDate) {
      dateWhere.createdAt = {};
      if (startDate) dateWhere.createdAt.gte = startDate;
      if (endDate) dateWhere.createdAt.lte = endDate;
    }

    const transactionWhere: Prisma.TransactionWhereInput = {
      type: 'cod_collection',
      order: { deletedAt: null },
    };
    if (Object.keys(dateWhere).length > 0) {
      transactionWhere.createdAt = dateWhere.createdAt;
    }
    if (requester && requester.role === 'delivery_agent') {
      transactionWhere.order = {
        ...transactionWhere.order as any,
        deliveryAgentId: requester.id
      };
    }

    // Outstanding Receivables from non-reconciled AgentCollection records (net of commission)
    // Uses operational records rather than GL account 1015 to ensure all delivered orders
    // are counted, including any that pre-date the GL automation system
    const tenantFilter = getTenantId();
    const outstandingCollections = await (prisma as any).agentCollection.aggregate({
      where: {
        status: { in: ['draft', 'verified', 'approved', 'deposited'] },
        order: { deletedAt: null, ...(tenantFilter ? { tenantId: tenantFilter } : {}) }
      },
      _sum: { amount: true }
    });
    const outstandingReceivables = Money.orZero(outstandingCollections._sum.amount);

    const [codCollections, outForDeliveryOrders] = await Promise.all([
      // COD Collected (operational metric)
      prisma.transaction.aggregate({
        where: {
          ...transactionWhere,
          status: { in: ['collected', 'deposited', 'reconciled'] }
        },
        _sum: { amount: true }
      }),
      // Pipeline Revenue: out-for-delivery orders (not yet in GL)
      prisma.order.aggregate({
        where: {
          status: 'out_for_delivery',
          codAmount: { not: null },
          deletedAt: null,
                    ...(requester && requester.role === 'delivery_agent' ? { deliveryAgentId: requester.id } : {}),
          ...(requester && requester.role === 'sales_rep' ? { customerRepId: requester.id } : {})
        },
        _sum: { totalAmount: true }
      })
    ]);

    const totalCOD = Money.orZero(codCollections._sum.amount);
    const outForDelivery = Money.orZero(outForDeliveryOrders._sum.totalAmount);
    // Pending COD = outstanding receivables (GL, delivered but uncollected) + out-for-delivery (operational)
    // Uses GL Cash in Transit for delivered-uncollected to stay consistent with accrual accounting
    const pendingCODAmount = Money.add(outstandingReceivables, outForDelivery);

    return {
      totalRevenue,
      digitalRevenue,
      paystackFees,
      totalExpenses,
      profit: Money.sub(totalRevenue, totalExpenses),
      codCollected: totalCOD,
      codPending: pendingCODAmount,
      outstandingReceivables,
      profitMargin: Money.percent(Money.sub(totalRevenue, totalExpenses), totalRevenue)
    };
  }

  /**
   * Get all transactions with filters
   */
  async getAllTransactions(filters: TransactionFilters, requester?: Requester) {
    const { type, status, page = 1, limit = 20 } = filters;

    const where: Prisma.TransactionWhereInput = {};
    if (type) where.type = type;
    if (status) where.status = status;


    // Role-based filtering for transactions
    if (requester && requester.role === 'sales_rep') {
      where.order = { customerRepId: requester.id };
    } else if (requester && requester.role === 'delivery_agent') {
      where.order = { deliveryAgentId: requester.id };
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        include: {
          order: {
            select: {
              // orderNumber removed - using id
              customer: {
                select: {
                  firstName: true,
                  lastName: true
                }
              },
              deliveryAgent: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.count({ where })
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Create expense record. A manual expense posts DR 5100, CR 1010 dated by the expense date, and keeps the entry id.
   * Every way of paying (cash, bank, MoMo) credits 1010, the one cash account. The result carries `notice` when the
   * date is in a closed month.
   */
  async recordExpense(data: CreateExpenseData, requester?: Requester) {
    const amount = Money.tryParse(data.amount);
    if (!amount || amount.lte(0)) {
      throw new AppError('Expense amount must be a positive number', 400);
    }
    const category = expenseCategoryOrThrow(data.category);
    const paidFrom = paidFromOrThrow(data.paidFrom);
    const receiptUrl = receiptUrlOrThrow(data.receiptUrl) ?? undefined;

    const userId = requester ? requester.id : parseInt(data.recordedBy, 10);

    const expense = await prisma.$transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          category,
          amount,
          description: data.description,
          expenseDate: data.expenseDate,
          recordedBy: userId,
          receiptUrl,
          paidFrom,
          source: 'manual',
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      });

      // Create GL journal entry for the expense
      const entry = await GLAutomationService.createExpenseGLEntry(
        tx as any,
        created.id,
        amount,
        data.description,
        userId,
        data.expenseDate
      );
      await tx.expense.update({ where: { id: created.id }, data: { journalEntryId: entry.id } });

      // Remap Prisma relation `user` → `recordedBy` for frontend compatibility
      const { user, ...rest } = created as any;
      return { ...rest, journalEntryId: entry.id, recordedBy: user || null };
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since expense data changed
    this.forecastCache.clear();

    logger.info('Expense recorded', {
      expenseId: expense.id,
      category: expense.category,
      amount: expense.amount
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitExpenseCreated(ioInstance as any, expense);
    }

    return { ...expense, notice: closedMonthNotice(data.expenseDate) };
  }

  /**
   * Get all expenses. `search` matches the description or the category. A delivery agent sees only their own rows.
   */
  async getAllExpenses(filters: DateFilters & { category?: string; search?: string; page?: number; limit?: number }, requester?: Requester) {
    const { startDate, endDate, category, search, page = 1, limit = 20 } = filters;

    const where: Prisma.ExpenseWhereInput = {};

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = startDate;
      if (endDate) where.expenseDate.lte = endDate;
    }

    if (category) where.category = category;
    if (search?.trim()) {
      where.OR = [
        { description: { contains: search.trim(), mode: 'insensitive' } },
        { category: { contains: search.trim(), mode: 'insensitive' } }
      ];
    }

    Object.assign(where, await expenseRowScope(requester));

    const skip = (page - 1) * limit;

    const [rawExpenses, totals] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }]
      }),
      prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true })
    ]);
    const total = totals._count;

    // Remap Prisma relation `user` → `recordedBy` for frontend compatibility. `locked` rows are read-only (F-917).
    const expenses = rawExpenses.map(({ user, ...rest }: any) => ({
      ...rest,
      locked: rest.source !== 'manual',
      recordedBy: user || null
    }));

    return {
      expenses,
      /** Sum of every row the filters match, not only this page: the breakdown total for the same filters equals it. */
      totalAmount: Money.orZero(totals._sum.amount),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get COD collections
   */
  async getCODCollections(filters: {
    agentId?: string;
    status?: PaymentStatus;
    page?: number;
    limit?: number;
  }, requester?: Requester) {
    const { agentId, status, page = 1, limit = 20 } = filters;

    const where: Prisma.TransactionWhereInput = {
      type: 'cod_collection',
      order: {
        deletedAt: null
      },
    };

    if (status) where.status = status;

    if (agentId) {
      where.order = {
        ...where.order as any,
        deliveryAgentId: parseInt(agentId, 10)
      };
    }

    // Role-based filtering for COD collections
    if (requester && requester.role === 'delivery_agent') {
      where.order = { deliveryAgentId: requester.id };
    }

    const skip = (page - 1) * limit;

    const [collections, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        include: {
          order: {
            select: {
              // orderNumber removed - using id
              deliveryAgent: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true
                }
              },
              customer: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.count({ where })
    ]);

    // Filter by agent if specified
    let filteredCollections = collections;
    if (agentId) {
      filteredCollections = collections.filter((c) => c.order?.deliveryAgent?.id === parseInt(agentId, 10));
    }

    return {
      collections: filteredCollections,
      pagination: {
        page,
        limit,
        total: agentId ? filteredCollections.length : total,
        pages: Math.ceil((agentId ? filteredCollections.length : total) / limit)
      }
    };
  }

  /**
   * Get COD collections by agent
   */
  async getCODCollectionsByAgent(agentId: string, filters?: DateFilters, requester?: Requester) {
    // Role-based ownership check for COD collections by agent
    if (requester && requester.role === 'delivery_agent' && parseInt(agentId, 10) !== requester.id) {
      throw new AppError('You do not have permission to view other agents collections', 403);
    }

    const where: Prisma.TransactionWhereInput = {
      type: 'cod_collection',
      order: {
        deliveryAgentId: parseInt(agentId, 10),
        deletedAt: null
      },
    };

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [collections, totalCollected, totalPending, totalDeposited] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          order: {
            select: {
              // orderNumber removed - using id
              customer: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.transaction.aggregate({
        where: { ...where, status: 'collected' },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: { ...where, status: 'pending' },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: { ...where, status: { in: ['deposited', 'reconciled'] } },
        _sum: { amount: true }
      })
    ]);

    return {
      collections,
      summary: {
        totalCollected: Money.orZero(totalCollected._sum.amount),
        totalPending: Money.orZero(totalPending._sum.amount),
        totalDeposited: Money.orZero(totalDeposited._sum.amount),
        totalCount: collections.length
      }
    };
  }

  /**
   * Reconcile transaction (update status)
   */
  async reconcileTransaction(data: ReconcileTransactionData, requester?: Requester) {
    const { transactionId, status, reference, notes } = data;

    const transaction = await prisma.transaction.findUnique({
      where: { id: parseInt(transactionId, 10) }
    });

    if (!transaction) {
      throw new AppError('Transaction not found', 404);
    }

    // Role-based ownership check for transaction
    if (!checkResourceOwnership(requester!, transaction, 'transaction')) {
      throw new AppError('You do not have permission to reconcile this transaction', 403);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedTx = await tx.transaction.update({
        where: { id: parseInt(transactionId, 10) },
        data: {
          status,
          reference,
          metadata: {
            ...((transaction.metadata as any) || {}),
            reconciliationNotes: notes,
            reconciledAt: new Date()
          }
        }
      });

      // Update order payment status if applicable
      if (transaction.orderId) {
        await tx.order.update({
          where: { id: transaction.orderId },
          data: { paymentStatus: status }
        });
      }

      return updatedTx;
    }, TRANSACTION_CONFIG);

    logger.info('Transaction reconciled', {
      transactionId,
      status,
      orderId: transaction.orderId
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitTransactionReconciled(ioInstance as any, updated);
    }

    return updated;
  }

  /**
   * Mark COD as deposited
   */
  async markCODAsDeposited(transactionIds: string[], depositReference?: string, requester?: Requester) {
    if (!transactionIds || transactionIds.length === 0) {
      throw new AppError('No transaction IDs provided', 400);
    }

    const transactionIdsAsNumbers = transactionIds.map((id) => parseInt(id, 10));

    // Get transactions to verify ownership/validity
    const transactions = await prisma.transaction.findMany({
      where: {
        id: { in: transactionIdsAsNumbers },
        type: 'cod_collection',
        status: 'collected',
        order: {
          deletedAt: null
        },
        },
      include: {
        order: {
          select: {
            deliveryAgentId: true,
            customerRepId: true,
            deliveryFee: true
          }
        }
      }
    });

    if (transactions.length === 0) {
      throw new AppError('No matching collected transactions found.', 404);
    }

    // Verify ownership for ALL transactions in the batch
    if (requester) {
      for (const trans of transactions) {
        const isOwner = checkResourceOwnership(requester, trans, 'transaction');
        if (!isOwner) {
          throw new AppError(`You do not have permission to deposit transaction ${trans.id}`, 403);
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Claim the transactions first: a parallel call for the same rows waits here, then finds none still 'collected'
      const result = await tx.transaction.updateMany({
        where: {
          id: { in: transactions.map(t => t.id) },
          status: 'collected'
        },
        data: {
          status: 'deposited',
          reference: depositReference
        }
      });
      if (result.count !== transactions.length) {
        throw new AppError('These transactions were changed by someone else. Reload and try again.', 409);
      }

      // Update corresponding orders
      const orderIds = transactions.filter(t => t.orderId).map(t => t.orderId as number);
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { paymentStatus: 'deposited' }
      });

      // The same entry a verified deposit posts (F-904): DR 1010, CR 1015, for the cash the partner kept net of its delivery fee.
      // Only what no deposit has covered yet is posted: a collection's outstanding amount. Skipped: a collection already
      // 'deposited' and one the old verify step posted (an agent_collection journal entry). The open collections are covered
      // through the same claim a verified deposit uses, so a later deposit cannot match them again and the partner balance drops.
      const collections = await tx.agentCollection.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, orderId: true, agentId: true, status: true, amount: true, allocatedAmount: true },
      });
      const oldPosted = new Set((await tx.journalEntry.findMany({
        where: { sourceType: 'agent_collection', sourceId: { in: collections.map((c) => c.id) }, isVoided: false },
        select: { sourceId: true },
      })).map((e) => e.sourceId));
      const collectionOf = new Map(collections.map((c) => [c.orderId, c]));
      const isOpen = (c: (typeof collections)[number]) => (OPEN_COLLECTION_STATUSES as readonly string[]).includes(c.status);
      const owed = (c: (typeof collections)[number]) => (c.status === 'deposited' || oldPosted.has(c.id) ? Money.ZERO : outstandingOf(c));

      const covers: Cover[] = collections.filter((c) => isOpen(c) && owed(c).gt(0)).map((c) => ({
        id: c.id, agentId: c.agentId, amount: Money.parse(c.amount), allocated: Money.orZero(c.allocatedAmount), take: owed(c),
      }));
      const { byCollection, byAgent } = await agentReconciliationService.claimCovers(tx, covers);

      // The collection holds the net amount; with no collection the net is the transaction minus the fee stamped on the order
      const depositAmount = Money.sum(
        transactions.map((t) => {
          const coll = t.orderId == null ? undefined : collectionOf.get(t.orderId);
          if (!coll) return partnerNetCash(t.order ?? {}, t.amount);
          // An open collection counts only if we won it; a reconciled one (no old posting) counts in full
          return isOpen(coll) ? (byCollection.get(coll.id) ?? Money.ZERO) : owed(coll);
        })
      );

      if (depositAmount.gt(0)) {
        const userId = requester?.id ?? await getSystemUserId();
        // Use the minimum transaction ID as a stable idempotency key for the batch.
        // transactions[0].id is order-dependent; Math.min is consistent across re-calls.
        const sourceId = Math.min(...transactions.map(t => t.id));
        await GLAutomationService.createDepositGLEntry(tx as any, depositAmount, sourceId, userId);
      }

      for (const [agentId, drop] of byAgent) {
        await tx.agentBalance.updateMany({
          where: { agentId },
          data: { totalDeposited: { increment: drop }, currentBalance: { decrement: drop }, lastSettlementDate: new Date() },
        });
      }

      return result;
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since deposit data changed
    this.forecastCache.clear();

    logger.info('COD marked as deposited', {
      transactionIds,
      count: updated.count,
      depositReference
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitTransactionDeposited(ioInstance as any, transactionIds, depositReference);
    }

    return {
      message: `${updated.count} transactions marked as deposited`,
      count: updated.count
    };
  }

  /**
   * Get financial reports
   */
  async getFinancialReports(filters: { period?: string; startDate?: Date; endDate?: Date }, requester?: Requester) {
    const { period = 'daily', startDate, endDate } = filters;

    const start = startDate || new Date();
    const end = endDate || new Date();

    const orderWhere: Prisma.OrderWhereInput = {
      status: 'delivered',
      updatedAt: {
        gte: start,
        lte: end
      },
      deletedAt: null,
    };

    // Role-based filtering for financial reports
    if (requester && requester.role === 'sales_rep') {
      orderWhere.customerRepId = requester.id;
    } else if (requester && requester.role === 'delivery_agent') {
      orderWhere.deliveryAgentId = requester.id;
    }

    const transactionWhere: Prisma.TransactionWhereInput = {
      createdAt: {
        gte: start,
        lte: end
      },
      order: {
        deletedAt: null
      }
    };
    if (requester && requester.role === 'delivery_agent') {
      transactionWhere.order = { deliveryAgentId: requester.id };
    }

    const expenseWhere: Prisma.ExpenseWhereInput = {
      expenseDate: {
        gte: start,
        lte: end
      },
    };
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      expenseWhere.recordedBy = requester.id;
    }


    const [expenses] = await Promise.all([
      prisma.expense.findMany({
        where: expenseWhere
      })
    ]);

    // Group by period
    const groupedData: Record<string, { revenue: Money.Money; expenses: Money.Money; orders: number }> = {};

    // Fetch delivered orders for the same period to get Accrual Revenue trends
    const deliveredOrders = await prisma.order.findMany({
      where: orderWhere,
      select: {
        totalAmount: true,
        updatedAt: true
      }
    });
    (deliveredOrders || []).forEach((order) => {
      const key =
        period === 'daily'
          ? order.updatedAt.toISOString().split('T')[0]
          : `${order.updatedAt.getFullYear()}-${String(order.updatedAt.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: Money.ZERO, expenses: Money.ZERO, orders: 0 };
      }

      groupedData[key].revenue = Money.add(groupedData[key].revenue, order.totalAmount);
      groupedData[key].orders += 1;
    });

    expenses.forEach((e) => {
      const key =
        period === 'daily'
          ? e.expenseDate.toISOString().split('T')[0]
          : `${e.expenseDate.getFullYear()}-${String(e.expenseDate.getMonth() + 1).padStart(2, '0')}`;

      if (!groupedData[key]) {
        groupedData[key] = { revenue: Money.ZERO, expenses: Money.ZERO, orders: 0 };
      }

      groupedData[key].expenses = Money.add(groupedData[key].expenses, e.amount);
    });

    const reports = Object.entries(groupedData).map(([date, data]) => ({
      date,
      revenue: data.revenue,
      expenses: data.expenses,
      profit: Money.sub(data.revenue, data.expenses),
      orders: data.orders
    })).sort((a, b) => a.date.localeCompare(b.date));

    return reports;
  }

  /**
   * Get expense breakdown by category
   */
  async getExpenseBreakdown(filters: DateFilters, requester?: Requester) {
    const where: Prisma.ExpenseWhereInput = {};

    if (filters.startDate || filters.endDate) {
      where.expenseDate = {};
      if (filters.startDate) where.expenseDate.gte = filters.startDate;
      if (filters.endDate) where.expenseDate.lte = filters.endDate;
    }



    Object.assign(where, await expenseRowScope(requester));

    const groups = await prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, _count: { _all: true } });

    return groups
      .map((g) => ({ category: g.category, totalAmount: Money.orZero(g._sum.amount), count: g._count._all }))
      .sort((a, b) => Money.compare(b.totalAmount, a.totalAmount));
  }

  /**
   * Get agent settlement report
   */
  async getAgentSettlement(agentId: string, filters?: DateFilters, requester?: Requester) {
    // Role-based ownership check for agent settlement
    if (requester && requester.role === 'delivery_agent' && parseInt(agentId, 10) !== requester.id) {
      throw new AppError('You do not have permission to view other agents settlements', 403);
    }

    // Get all COD collections by agent
    const codData = await this.getCODCollectionsByAgent(agentId, filters, requester);

    // Calculate pending settlement
    const pendingAmount = Money.sub(codData.summary.totalCollected, codData.summary.totalDeposited);

    return {
      agentId,
      totalCollected: codData.summary.totalCollected,
      totalDeposited: codData.summary.totalDeposited,
      pendingSettlement: pendingAmount,
      collections: codData.collections
    };
  }

  /**
   * Get comprehensive profitability analysis
   */
  async getProfitabilityAnalysis(filters: { startDate?: Date; endDate?: Date; productId?: number }) {
    // The controller hands over store-day bounds: endDate is already the last millisecond of its store day.
    const { startDate, endDate, productId } = filters;

    // Filter orders by GL journal entry date (not deliveryDate) so breakdowns
    // align with the GL-based summary KPIs. deliveryDate and GL entryDate can
    // diverge for backfilled orders. Since glJournalEntryId may be null on
    // orders, we look up order IDs via journal_entries.source_id instead.
    const orderWhere: Prisma.OrderWhereInput = {
      status: 'delivered',
      revenueRecognized: true,
      deletedAt: null,
    };

    if (startDate || endDate) {
      // Find order IDs that have GL revenue entries in the date range
      const glOrderEntries = await prisma.journalEntry.findMany({
        where: {
          sourceType: 'order_delivery',
          isVoided: false,
          entryDate: {
            ...(startDate ? { gte: startDate } : {}),
            ...(endDate ? { lte: endDate } : {}),
          },
            },
        select: { sourceId: true },
      });
      const glOrderIds = glOrderEntries
        .map(e => e.sourceId)
        .filter((id): id is number => id !== null);
      orderWhere.id = { in: glOrderIds };
    }

    if (productId) {
      orderWhere.orderItems = {
        some: {
          productId: productId,
        },
      };
    }

    // Fetch orders with items and products
    const orders = await prisma.order.findMany({
      where: orderWhere,
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        deliveryAgent: { select: { commissionAmount: true } },
        customerRep: { select: { commissionAmount: true } },
      },
    });

    // Calculate revenue and COGS
    let totalCOGS = Money.ZERO;
    let totalShippingCost = Money.ZERO;
    let totalDiscount = Money.ZERO;

    const productProfitability: Record<number, {
      id: number,
      name: string,
      sku: string,
      revenue: Money.Money,
      cogs: Money.Money,
      quantity: number,
      commission: Money.Money,
      grossProfit: Money.Money
    }> = {};

    const dailyProfitability: Record<string, {
      date: string,
      revenue: Money.Money,
      cogs: Money.Money,
      grossProfit: Money.Money
    }> = {};

    for (const order of orders) {
      // Use totalAmount (subtotal + shipping - discount) to match GL revenue recognition
      totalShippingCost = Money.add(totalShippingCost, order.shippingCost);
      totalDiscount = Money.add(totalDiscount, order.discount);

      const dateStr = (order.deliveryDate || order.updatedAt).toISOString().split('T')[0];
      if (!dailyProfitability[dateStr]) {
        dailyProfitability[dateStr] = {
          date: dateStr,
          revenue: Money.ZERO,
          cogs: Money.ZERO,
          grossProfit: Money.ZERO
        };
      }
      dailyProfitability[dateStr].revenue = Money.add(dailyProfitability[dateStr].revenue, order.totalAmount);

      const orderCommission = Money.add(
        Money.orZero(order.deliveryAgent?.commissionAmount),
        Money.orZero(order.customerRep?.commissionAmount)
      );
      const orderSubtotal = Money.sum(
        order.orderItems.map(item => Money.mul(item.unitPrice, item.quantity))
      );

      for (const item of order.orderItems) {
        const itemCOGS = Money.mul(Money.orZero(item.product.cogs), item.quantity);
        totalCOGS = Money.add(totalCOGS, itemCOGS);
        dailyProfitability[dateStr].cogs = Money.add(dailyProfitability[dateStr].cogs, itemCOGS);

        const itemRevenue = Money.mul(item.unitPrice, item.quantity);
        const itemCommission = Money.gt(orderSubtotal, 0)
          ? Money.div(Money.mul(orderCommission, itemRevenue), orderSubtotal)
          : Money.ZERO;

        if (!productProfitability[item.productId]) {
          productProfitability[item.productId] = {
            id: item.productId,
            name: item.product.name,
            sku: item.product.sku,
            revenue: Money.ZERO,
            cogs: Money.ZERO,
            quantity: 0,
            commission: Money.ZERO,
            grossProfit: Money.ZERO
          };
        }

        const productStats = productProfitability[item.productId];
        productStats.revenue = Money.add(productStats.revenue, itemRevenue);
        productStats.cogs = Money.add(productStats.cogs, itemCOGS);
        productStats.quantity += item.quantity;
        productStats.commission = Money.add(productStats.commission, itemCommission);
      }
    }

    // Query GL using entryDate (same filter as P&L / Overview) — single source of truth
    const glEntryDateFilter: any = {};
    if (startDate || endDate) {
      glEntryDateFilter.entryDate = {};
      if (startDate) glEntryDateFilter.entryDate.gte = startDate;
      if (endDate) glEntryDateFilter.entryDate.lte = endDate;
    }

    // GL Revenue — use account 4010 (same as Overview) so numbers always match
    const revenueAgg = await prisma.accountTransaction.aggregate({
      where: {
        account: { code: GL_ACCOUNTS.PRODUCT_REVENUE },
        journalEntry: { isVoided: false, ...glEntryDateFilter },
        },
      _sum: { debitAmount: true, creditAmount: true }
    });
    // Revenue account has credit-normal balance
    const glRevenue = Money.sub(Money.orZero(revenueAgg._sum.creditAmount), Money.orZero(revenueAgg._sum.debitAmount));

    const commissionCodes = [...RETIRED_EXPENSE_CODES, GL_ACCOUNTS.DELIVERY_FEES, GL_ACCOUNTS.SALES_REP_COMMISSION];

    const expenseAgg = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        account: { accountType: 'expense' },
        journalEntry: { isVoided: false, ...glEntryDateFilter },
        },
      _sum: { debitAmount: true, creditAmount: true }
    });

    // Map account IDs to codes for categorization
    const expenseAccounts = await prisma.account.findMany({
      where: { accountType: 'expense' },
      select: { id: true, code: true }
    });
    const commissionIdSet = new Set(
      expenseAccounts.filter(a => (commissionCodes as string[]).includes(a.code)).map(a => a.id)
    );
    const cogsIdSet = new Set(
      expenseAccounts.filter(a => a.code === GL_ACCOUNTS.COGS).map(a => a.id)
    );

    const netDebit = (r: (typeof expenseAgg)[number]) =>
      Money.sub(Money.orZero(r._sum.debitAmount), Money.orZero(r._sum.creditAmount));

    const glCOGS = Money.sum(expenseAgg
      .filter(r => cogsIdSet.has(r.accountId))
      .map(netDebit));

    const totalCommissions = Money.sum(expenseAgg
      .filter(r => commissionIdSet.has(r.accountId))
      .map(netDebit));

    const totalOperatingExpenses = Money.sum(expenseAgg
      .filter(r => !commissionIdSet.has(r.accountId) && !cogsIdSet.has(r.accountId))
      .map(netDebit));

    // Use GL revenue + GL COGS for summary totals (matches Overview exactly)
    const grossProfit = Money.sub(glRevenue, glCOGS);
    const grossMargin = Money.percent(grossProfit, glRevenue);

    const netProfit = Money.sub(Money.sub(grossProfit, totalCommissions), totalOperatingExpenses);
    const netMargin = Money.percent(netProfit, glRevenue);

    // Format product profitability
    const products = Object.values(productProfitability).map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      revenue: p.revenue,
      cogs: p.cogs,
      quantity: p.quantity,
      commission: p.commission,
      grossProfit: Money.sub(p.revenue, p.cogs),
      grossMargin: Money.percent(Money.sub(p.revenue, p.cogs), p.revenue)
    })).sort((a, b) => Money.compare(b.grossProfit, a.grossProfit));

    // Format daily profitability
    const daily = Object.values(dailyProfitability).map(d => ({
      ...d,
      grossProfit: Money.sub(d.revenue, d.cogs),
      grossMargin: Money.percent(Money.sub(d.revenue, d.cogs), d.revenue)
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
      summary: {
        totalRevenue: glRevenue,
        totalCOGS: glCOGS,
        totalShippingCost,
        totalDiscount,
        totalCommissions,
        totalOperatingExpenses,
        grossProfit,
        grossMargin,
        netProfit,
        netMargin,
        orderCount: orders.length,
        dataSources: {
          revenue: 'GL account 4010 (matches Overview)',
          cogs: 'GL account 5010 (matches Overview)',
          commissions: 'GL accounts 5040/5050 (accrual)',
          operatingExpenses: 'GL non-COGS, non-commission expense accounts',
        }
      },
      products,
      daily,
    };
  }

  /**
   * Update an existing expense. A new amount or date voids the old ledger entry (reversal kept) and posts a new one
   * dated by the expense date. A change of category, description, paid from or receipt leaves the ledger alone.
   */
  async updateExpense(
    expenseId: string,
    data: {
      category?: string;
      amount?: Money.MoneyInput;
      description?: string;
      expenseDate?: Date;
      paidFrom?: string | null;
      receiptUrl?: string | null;
    }
    , requester?: Requester) {
    let newAmount: Money.Money | undefined;
    if (data.amount !== undefined) {
      const parsed = Money.tryParse(data.amount);
      if (!parsed || parsed.lte(0)) throw new AppError('Expense amount must be a positive number', 400);
      newAmount = parsed;
    }
    const category = data.category !== undefined ? expenseCategoryOrThrow(data.category) : undefined;
    const paidFrom = data.paidFrom !== undefined ? paidFromOrThrow(data.paidFrom) : undefined;
    const receiptUrl = data.receiptUrl !== undefined ? receiptUrlOrThrow(data.receiptUrl) : undefined;

    const expense = await prisma.expense.findUnique({
      where: { id: parseInt(expenseId, 10) }
    });

    if (!expense) {
      throw new AppError('Expense not found', 404);
    }
    assertExpenseEditable(expense);

    if (!(await ownsExpense(requester, expense))) {
      throw new AppError('You do not have permission to update this expense', 403);
    }

    const numericId = parseInt(expenseId, 10);
    const actorId = requester?.id ?? await getSystemUserId();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.expense.update({
        where: { id: numericId },
        data: {
          ...(category && { category }),
          ...(newAmount !== undefined && { amount: newAmount }),
          ...(data.description && { description: data.description }),
          ...(data.expenseDate && { expenseDate: data.expenseDate }),
          ...(paidFrom !== undefined && { paidFrom }),
          ...(receiptUrl !== undefined && { receiptUrl })
        },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      });

      let journalEntryId = result.journalEntryId;
      if ((newAmount !== undefined && !newAmount.eq(expense.amount))
        || (data.expenseDate !== undefined && data.expenseDate.getTime() !== expense.expenseDate.getTime())) {
        // Void the old entry, then post the new one with the new amount and date
        await GLAutomationService.voidJournalEntry(tx as any, 'expense', numericId, actorId);
        const entry = await GLAutomationService.createExpenseGLEntry(
          tx as any,
          numericId,
          result.amount,
          result.description,
          actorId,
          result.expenseDate
        );
        journalEntryId = entry.id;
        await tx.expense.update({ where: { id: numericId }, data: { journalEntryId } });
      }

      // Remap Prisma relation `user` → `recordedBy` for frontend compatibility
      const { user, ...rest } = result as any;
      return { ...rest, journalEntryId, recordedBy: user || null };
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since expense data changed
    this.forecastCache.clear();

    logger.info('Expense updated', {
      expenseId,
      changes: data
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitExpenseUpdated(ioInstance as any, updated);
    }

    return { ...updated, notice: closedMonthNotice(updated.expenseDate, expense.expenseDate) };
  }

  /**
   * Delete an expense. Its ledger entry is voided by a reversal first, so the account balances return to what
   * they were before the expense.
   */
  async deleteExpense(expenseId: string, requester?: Requester) {
    const expense = await prisma.expense.findUnique({
      where: { id: parseInt(expenseId, 10) }
    });

    if (!expense) {
      throw new AppError('Expense not found', 404);
    }
    assertExpenseEditable(expense);

    if (!(await ownsExpense(requester, expense))) {
      throw new AppError('You do not have permission to delete this expense', 403);
    }

    const numericExpenseId = parseInt(expenseId, 10);
    await prisma.$transaction(async (tx) => {
      // Void GL entry before deleting expense
      await GLAutomationService.voidJournalEntry(tx as any, 'expense', numericExpenseId, requester?.id ?? await getSystemUserId());

      await tx.expense.delete({
        where: { id: numericExpenseId }
      });
    }, TRANSACTION_CONFIG);

    // Invalidate forecast cache since expense data changed
    this.forecastCache.clear();

    logger.info('Expense deleted', {
      expenseId,
      category: expense.category,
      amount: expense.amount
    });

    // Emit Socket.io event
    const ioInstance = getSocketInstance();
    if (ioInstance) {
      emitExpenseDeleted(ioInstance as any, expenseId);
    }

    return { message: 'Expense deleted successfully', notice: closedMonthNotice(expense.expenseDate) };
  }

  /**
   * Get pipeline revenue (expected revenue from active orders)
   */
  async getPipelineRevenue(requester?: Requester) {
    const where: Prisma.OrderWhereInput = {
      status: {
        in: PENDING_STATUSES
      },
      deletedAt: null,
    };

    // Role-based filtering for pipeline revenue
    if (requester && requester.role === 'sales_rep') {
      where.customerRepId = requester.id;
    } else if (requester && requester.role === 'delivery_agent') {
      where.deliveryAgentId = requester.id;
    }

    const groups = await prisma.order.groupBy({
      by: ['status'],
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
    });

    const byStatus = groups.map((g) => ({
      status: g.status as string,
      amount: Money.orZero(g._sum.totalAmount),
      count: g._count._all,
    }));
    const totalExpected = Money.sum(byStatus.map((g) => g.amount));

    return {
      totalExpected,
      byStatus
    };
  }

  /**
   * Get agent cash holdings (collected but not deposited)
   */
  async getAgentCashHoldings(requester?: Requester) {
    // 1. Get all agents with a non-zero balance from AgentBalance
    const query: Prisma.AgentBalanceWhereInput = {
      currentBalance: { gt: 0 },
    };

    if (requester && requester.role === 'delivery_agent') {
      query.agentId = requester.id;
    }

    const balances = await prisma.agentBalance.findMany({
      where: query,
      include: {
        agent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    }) || [];

    if (balances.length === 0) return [];

    // 2. Batch query all agent collection stats in a single groupBy (avoids N+1)
    const agentIds = balances.map(b => b.agentId);
    const [collectionCounts, oldestCollections] = await Promise.all([
      (prisma as any).agentCollection.groupBy({
        by: ['agentId'],
        where: {
          agentId: { in: agentIds },
          status: { in: [...OPEN_COLLECTION_STATUSES] }
        },
        _count: { id: true },
      }),
      (prisma as any).agentCollection.groupBy({
        by: ['agentId'],
        where: {
          agentId: { in: agentIds },
          status: { in: [...OPEN_COLLECTION_STATUSES] }
        },
        _min: { collectionDate: true },
      }),
    ]);

    // Build lookup maps
    const countMap = new Map<number, number>();
    for (const row of collectionCounts) {
      countMap.set(row.agentId, row._count.id);
    }
    const oldestMap = new Map<number, Date>();
    for (const row of oldestCollections) {
      if (row._min.collectionDate) {
        oldestMap.set(row.agentId, row._min.collectionDate);
      }
    }

    const holdings: AgentHolding[] = balances.map((b) => ({
      agent: {
        id: b.agent.id,
        firstName: b.agent.firstName,
        lastName: b.agent.lastName,
        email: b.agent.email
      },
      totalCollected: Money.orZero(b.currentBalance),
      orderCount: countMap.get(b.agentId) || 0,
      OldestCollectionDate: oldestMap.get(b.agentId) || b.updatedAt
    }));

    // Sort by total collected (descending)
    return holdings.sort((a, b) => Money.compare(b.totalCollected, a.totalCollected)).slice(0, 20);
  }

  /**
   * Get Cash Flow Report
   */
  async getCashFlowReport(requester?: Requester) {
    // 1. Get current cash position KPIs from GL
    const tenantId = resolveTenantId();
    const [cashInHand, , arAgents] = await Promise.all([
      prisma.account.findUnique({ where: { tenantId_code: { tenantId, code: GL_ACCOUNTS.CASH_IN_HAND } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId, code: GL_ACCOUNTS.CASH_IN_TRANSIT } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId, code: GL_ACCOUNTS.AR_AGENTS } } }),
    ]);

    // 2. Calculate operational figures from actual order status
    const [cashInTransitData, cashExpectedData] = await Promise.all([
      prisma.order.aggregate({
        where: {
          status: 'delivered',
          paymentStatus: { notIn: ['reconciled', 'deposited'] },
          deletedAt: null,
            },
        _sum: { totalAmount: true }
      }),
      prisma.order.aggregate({
        where: {
          status: 'out_for_delivery',
          deletedAt: null,
          codAmount: { not: null },
            },
        _sum: { totalAmount: true }
      })
    ]);

    const kpis = {
      cashInHand: Money.orZero(cashInHand?.currentBalance),
      cashInTransit: Money.orZero(cashInTransitData._sum.totalAmount),
      outstandingReceivables: Money.orZero(arAgents?.currentBalance),
      cashExpected: Money.orZero(cashExpectedData._sum.totalAmount),
    };

    const cashAvailableNow = Money.add(kpis.cashInHand, kpis.outstandingReceivables);
    const totalCashPosition = Money.sum([kpis.cashInHand, kpis.cashInTransit, kpis.outstandingReceivables, kpis.cashExpected]);
    const totalCashPipeline = Money.sum([cashAvailableNow, kpis.cashInTransit, kpis.cashExpected]);

    // 3. 30-day Forecast
    const forecast = await this.generateCashFlowForecast();

    // 4. Agent Breakdown (Pending collections)
    const agentBreakdown = await this.getAgentCashHoldings(requester);

    return {
      kpis: { ...kpis, cashAvailableNow, totalCashPosition, totalCashPipeline },
      forecast,
      agentBreakdown
    };
  }

  /**
   * Generate 30-day Cash Flow Forecast
   * Uses historical data (last 30 days) to project future flows
   */
  async generateCashFlowForecast() {
    const tenantId = getTenantId();
    const cacheKey = tenantId ?? '__system__';
    const cached = this.forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.FORECAST_CACHE_DURATION_MS) {
      return cached.data;
    }

    // Calculate historical averages (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [historicalCollections, historicalExpenses] = await Promise.all([
      prisma.transaction.aggregate({
        where: {
          type: 'cod_collection',
          status: { in: ['collected', 'deposited', 'reconciled'] },
          createdAt: { gte: thirtyDaysAgo },
          order: {
            deletedAt: null
          },
            },
        _sum: { amount: true }
      }),
      prisma.expense.aggregate({
        where: {
          expenseDate: { gte: thirtyDaysAgo },
            },
        _sum: { amount: true }
      })
    ]);

    const avgDailyCollection = Money.div(Money.orZero(historicalCollections._sum.amount), 30);
    const avgDailyExpense = Money.div(Money.orZero(historicalExpenses._sum.amount), 30);

    // Start with current liquidity (Cash in Hand + Bank if existed)
    // For this implementation, we'll use Total Cash Position as starting balance
    const accountTenantId = resolveTenantId(tenantId);
    const [cashInHand, cashInTransit] = await Promise.all([
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: accountTenantId, code: GL_ACCOUNTS.CASH_IN_HAND } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: accountTenantId, code: GL_ACCOUNTS.CASH_IN_TRANSIT } } }),
    ]);

    let runningBalance = Money.add(Money.orZero(cashInHand?.currentBalance), Money.orZero(cashInTransit?.currentBalance));

    const forecast: CashFlowForecast[] = [];
    const today = new Date();

    for (let i = 1; i <= 30; i++) {
      const forecastDate = new Date(today);
      forecastDate.setDate(today.getDate() + i);

      runningBalance = Money.add(runningBalance, Money.sub(avgDailyCollection, avgDailyExpense));

      forecast.push({
        date: forecastDate.toISOString().split('T')[0],
        expectedCollection: avgDailyCollection,
        expectedExpense: avgDailyExpense,
        projectedBalance: runningBalance.lt(0) ? Money.ZERO : runningBalance
      });
    }

    this.forecastCache.set(cacheKey, { data: forecast, timestamp: Date.now() });
    return forecast;
  }

  /**
   * Export Cash Flow Report as CSV
   */
  async exportCashFlowCSV(requester?: Requester) {
    const report = await this.getCashFlowReport(requester);

    // Prepare data for CSV
    const csvData = [
      { Section: 'KPIs', Label: 'Cash in Hand', Value: Money.toApi(report.kpis.cashInHand) },
      { Section: 'KPIs', Label: 'Cash in Transit', Value: Money.toApi(report.kpis.cashInTransit) },
      { Section: 'KPIs', Label: 'Outstanding Receivables', Value: Money.toApi(report.kpis.outstandingReceivables) },
      { Section: 'KPIs', Label: 'Cash Expected', Value: Money.toApi(report.kpis.cashExpected) },
      { Section: 'KPIs', Label: 'Total Cash Position', Value: Money.toApi(report.kpis.totalCashPosition) },
      { Section: '---', Label: '---', Value: '---' },
      { Section: 'Forecast (Next 30 Days)', Label: 'Date', Value: 'Projected Balance' },
      ...report.forecast.map(f => ({
        Section: 'Forecast',
        Label: f.date,
        Value: Money.toApi(f.projectedBalance)
      }))
    ];

    const parser = new Parser();
    return parser.parse(csvData);
  }

  /**
   * Get Balance Sheet as of a specific date
   */
  async getBalanceSheet(asOfDateValue?: string | Date) {
    // The whole store day is included: a date-only value or any instant moves to the last millisecond of its store day.
    const zone = getStoreTimeZone(getTenantId());
    const asOfDate = parseInclusiveBound(
      asOfDateValue instanceof Date ? asOfDateValue.toISOString() : asOfDateValue || new Date().toISOString(),
      'to', zone, { snapToDay: true });

    // Query all active accounts
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        normalBalance: true
      }
    });

    // Use Prisma groupBy to aggregate transactions for all accounts at once
    const aggregations = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: { isVoided: false, entryDate: { lte: asOfDate } },
        },
      _sum: {
        debitAmount: true,
        creditAmount: true
      }
    });

    // Create a map for quick lookup
    const aggregationMap = new Map<number, { debit: Money.Money; credit: Money.Money }>();
    aggregations.forEach(agg => {
      aggregationMap.set(agg.accountId, {
        debit: Money.orZero(agg._sum.debitAmount),
        credit: Money.orZero(agg._sum.creditAmount)
      });
    });

    const categories: Record<string, { accounts: FinancialStatementAccount[]; total: Money.Money }> = {
      asset: { accounts: [], total: Money.ZERO },
      liability: { accounts: [], total: Money.ZERO },
      equity: { accounts: [], total: Money.ZERO },
      revenue: { accounts: [], total: Money.ZERO },
      expense: { accounts: [], total: Money.ZERO }
    };

    // Process accounts using pre-calculated aggregations
    accounts.forEach(account => {
      const agg = aggregationMap.get(account.id) || { debit: Money.ZERO, credit: Money.ZERO };

      const balance = account.normalBalance === 'debit'
        ? Money.sub(agg.debit, agg.credit)
        : Money.sub(agg.credit, agg.debit);

      const financialAccount = {
        id: account.id,
        code: account.code,
        name: account.name,
        balance
      };

      if (categories[account.accountType]) {
        categories[account.accountType].accounts.push(financialAccount);
        categories[account.accountType].total = Money.add(categories[account.accountType].total, balance);
      }
    });

    // Calculate Retained Earnings: Total Revenue - Total Expense (all time up to asOfDate)
    const retainedEarnings = Money.sub(categories.revenue.total, categories.expense.total);

    // Equity: System Equity Accounts + Retained Earnings
    const totalEquity = Money.add(categories.equity.total, retainedEarnings);
    const totalLiabilitiesAndEquity = Money.add(categories.liability.total, totalEquity);
    const totalAssets = categories.asset.total;

    return {
      asOfDate,
      assets: categories.asset,
      liabilities: categories.liability,
      equity: {
        accounts: categories.equity.accounts,
        retainedEarnings,
        total: totalEquity
      },
      totalLiabilitiesAndEquity,
      isBalanced: Money.sub(totalAssets, totalLiabilitiesAndEquity).abs().lt('0.01')
    } as BalanceSheetData;
  }

  /**
   * Get Profit and Loss Statement for a specific period
   */
  async getProfitLoss(startDateValue: string | Date, endDateValue: string | Date) {
    // Store-zone days: the start is the start of its store day, the end the last millisecond of its store day.
    const zone = getStoreTimeZone(getTenantId());
    const asString = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);
    const startDate = parseInclusiveBound(asString(startDateValue), 'from', zone);
    const endDate = parseInclusiveBound(asString(endDateValue), 'to', zone, { snapToDay: true });

    // Query all revenue and expense accounts
    const accounts = await prisma.account.findMany({
      where: {
        isActive: true,
        accountType: { in: ['revenue', 'expense'] }
      },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        normalBalance: true
      }
    });

    const aggregations = await prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        journalEntry: { isVoided: false, entryDate: { gte: startDate, lte: endDate } },
        },
      _sum: {
        debitAmount: true,
        creditAmount: true
      }
    });

    const aggregationMap = new Map<number, { debit: Money.Money; credit: Money.Money }>();
    aggregations.forEach(agg => {
      aggregationMap.set(agg.accountId, {
        debit: Money.orZero(agg._sum.debitAmount),
        credit: Money.orZero(agg._sum.creditAmount)
      });
    });

    const result: ProfitLossData = {
      startDate,
      endDate,
      revenue: { accounts: [], total: Money.ZERO },
      cogs: { accounts: [], total: Money.ZERO },
      expenses: { accounts: [], total: Money.ZERO },
      grossProfit: Money.ZERO,
      grossMarginPercentage: 0,
      netIncome: Money.ZERO,
      netMarginPercentage: 0
    };

    accounts.forEach(account => {
      const agg = aggregationMap.get(account.id) || { debit: Money.ZERO, credit: Money.ZERO };

      const balance = account.normalBalance === 'debit'
        ? Money.sub(agg.debit, agg.credit)
        : Money.sub(agg.credit, agg.debit);

      const financialAccount = {
        id: account.id,
        code: account.code,
        name: account.name,
        balance
      };

      if (account.accountType === 'revenue') {
        result.revenue.accounts.push(financialAccount);
        result.revenue.total = Money.add(result.revenue.total, balance);
      } else if (account.accountType === 'expense') {
        if (account.code === GL_ACCOUNTS.COGS) {
          result.cogs.accounts.push(financialAccount);
          result.cogs.total = Money.add(result.cogs.total, balance);
        } else {
          result.expenses.accounts.push(financialAccount);
          result.expenses.total = Money.add(result.expenses.total, balance);
        }
      }
    });

    result.grossProfit = Money.sub(result.revenue.total, result.cogs.total);
    result.grossMarginPercentage = Money.percent(result.grossProfit, result.revenue.total);
    result.netIncome = Money.sub(result.grossProfit, result.expenses.total);
    result.netMarginPercentage = Money.percent(result.netIncome, result.revenue.total);

    return result;
  }
}

export default new FinancialService();
