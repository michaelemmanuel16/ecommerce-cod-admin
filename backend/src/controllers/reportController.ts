import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { resolveTenantId } from '../utils/tenantContext';
import { hasPermission } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { invalidRange, readRange } from '../utils/kpiRequest';
import { teamReport } from '../services/teamReportService';
import { REPORT_TABS, buildReport, reportRange, type ReportTab } from '../services/reportsService';
import { SHEET_TITLES, sectionsOf, writeCsv, writeXlsx, type ExportSheet, type ExportTab } from '../services/reportExportService';

/** GET /api/reports/team?from&to  (dates as in /api/kpi: a date-only `to` is inclusive) */
export const getTeamReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    res.json(await teamReport(tenantId, from, to));
  } catch (error) {
    next(error);
  }
};

/** `compare=previous` (or true or 1) turns the previous period on; absent, none, false or 0 leaves it off. */
function readCompare(req: Request): boolean {
  const { compare } = req.query;
  if (compare === undefined || compare === 'none' || compare === 'false' || compare === '0') return false;
  if (compare === 'previous' || compare === 'true' || compare === '1') return true;
  throw invalidRange('compare must be previous or none');
}

/**
 * GET /api/reports/:tab?from&to&compare=previous  for overview, sales and delivery (F-1050 to F-1053).
 * The controller reads the query and the viewer's permissions; every number comes from services/reportsService.
 */
export const getReport = (tab: ReportTab) => async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const { from, to } = readRange(req, tenantId);
    const range = reportRange(tenantId, from, to, readCompare(req));
    const cash = await hasPermission(req.user!, 'financial', 'view');
    res.json(await buildReport(tab, tenantId, range, { cash }));
  } catch (error) {
    next(error);
  }
};

/** Tabs that belong to a later milestone (Products M5, Marketing M8): the permission answers first, then the tab is not built yet. */
export const tabNotBuilt = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new AppError('This report is not available yet', 404, 'TAB_NOT_AVAILABLE'));
};

const FORMATS = ['csv', 'xlsx'] as const;
type Format = (typeof FORMATS)[number];
const EXPORT_TABS = [...REPORT_TABS, 'team'] as const;

const REPORT_ROLES = ['super_admin', 'admin', 'manager', 'accountant'];
const TEAM_ROLES = ['super_admin', 'admin', 'manager'];

/** Who may open a tab (F-1050). Call reps and agents have no Reports whatever their `analytics:view`. */
async function canOpenTab(user: NonNullable<AuthRequest['user']>, tab: string): Promise<boolean> {
  const roles = tab === 'team' ? TEAM_ROLES : REPORT_ROLES;
  if (!roles.includes(user.role)) return false;
  if (tab === 'marketing') return hasPermission(user, 'marketing', 'view');
  if (tab === 'products') return hasPermission(user, 'financial', 'view');
  return hasPermission(user, 'analytics', 'view');
}

/**
 * GET /api/reports/:tab/export?from&to&compare&format=csv|xlsx  (F-1057). tab is overview, sales, delivery or team,
 * or `all` for one Excel workbook with a sheet per tab the viewer may open. The file is written as it is built,
 * nothing is stored. There is no PDF.
 */
export const exportReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = resolveTenantId();
    const user = req.user!;
    const tab = String(req.params.tab);
    const known = tab === 'all' || (EXPORT_TABS as readonly string[]).includes(tab);
    const later = tab === 'products' || tab === 'marketing';
    if (!known && !later) throw new AppError('Unknown report', 404, 'TAB_NOT_FOUND');
    // Permission first, so a viewer without marketing:view gets 403 and not "not available yet"
    if (tab !== 'all' && !(await canOpenTab(user, tab))) throw new AppError('You do not have access to this report', 403, 'INSUFFICIENT_PERMISSION');
    if (tab === 'all' && !(await canOpenTab(user, 'overview'))) throw new AppError('You do not have access to reports', 403, 'INSUFFICIENT_PERMISSION');
    if (!(await hasPermission(user, 'analytics', 'export'))) throw new AppError('You do not have permission to export data', 403, 'INSUFFICIENT_PERMISSION');
    if (later) throw new AppError('This report is not available yet', 404, 'TAB_NOT_AVAILABLE');

    const format = String(req.query.format ?? '');
    if (!(FORMATS as readonly string[]).includes(format)) throw invalidRange('format must be csv or xlsx');
    if (tab === 'all' && format !== 'xlsx') throw invalidRange('All reports come as one Excel file: format=xlsx');

    const { from, to } = readRange(req, tenantId);
    const range = reportRange(tenantId, from, to, readCompare(req));
    const cash = await hasPermission(user, 'financial', 'view');

    const tabs: ExportTab[] = tab === 'all'
      ? ['overview', 'sales', 'delivery', ...((await canOpenTab(user, 'team')) ? ['team' as const] : [])]
      : [tab as ExportTab];
    const sheets: ExportSheet[] = [];
    for (const t of tabs) {
      const body = t === 'team' ? null : await buildReport(t, tenantId, range, { cash });
      sheets.push({ name: SHEET_TITLES[t], sections: await sectionsOf(t, tenantId, range, body) });
    }

    const name = `${tab === 'all' ? 'all-reports' : tab}-${range.fromYmd}-${range.toYmd}.${format as Format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      await writeCsv(res, sheets[0].sections);
    } else {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await writeXlsx(res, sheets);
    }
  } catch (error) {
    next(error);
  }
};
