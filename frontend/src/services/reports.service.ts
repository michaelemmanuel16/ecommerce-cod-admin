import { apiClient } from './api';
import type { ReportBody, ReportParams, ReportTabId } from '../pages/reports/types';

export type ExportFormat = 'csv' | 'xlsx';

export const reportsService = {
  /** GET /api/reports/:tab. `from` and `to` are store days (YYYY-MM-DD), `to` inclusive. */
  async get<T extends ReportBody>(tab: ReportTabId, params: ReportParams, fresh = false): Promise<T> {
    const { data } = await apiClient.get<T>(`/api/reports/${tab}`, {
      params: { from: params.from, to: params.to, ...(params.compare && { compare: 'previous' }) },
      skipCache: fresh,
    });
    return data;
  },

  /**
   * GET /api/reports/:tab/export (F-1057): downloads the open tab, or `all` (Excel only, one workbook). Resolves with the
   * file name the server chose (<tab>-<from>-<to>.csv, all-reports-<from>-<to>.xlsx).
   */
  async download(tab: ReportTabId | 'all', params: ReportParams, format: ExportFormat): Promise<string> {
    const response = await apiClient.get(`/api/reports/${tab}/export`, {
      params: { from: params.from, to: params.to, ...(params.compare && { compare: 'previous' }), format },
      responseType: 'blob',
      skipCache: true,
    });
    const named = /filename="?([^";]+)"?/.exec(String(response.headers?.['content-disposition'] ?? ''));
    const name = named?.[1] ?? `${tab === 'all' ? 'all-reports' : tab}-${params.from}-${params.to}.${format}`;
    const url = window.URL.createObjectURL(response.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    return name;
  },
};
