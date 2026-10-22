import { apiClient } from './api';
import type { ReportBody, ReportParams, ReportTabId } from '../pages/reports/types';

export const reportsService = {
  /** GET /api/reports/:tab. `from` and `to` are store days (YYYY-MM-DD), `to` inclusive. */
  async get<T extends ReportBody>(tab: ReportTabId, params: ReportParams, fresh = false): Promise<T> {
    const { data } = await apiClient.get<T>(`/api/reports/${tab}`, {
      params: { from: params.from, to: params.to, ...(params.compare && { compare: 'previous' }) },
      skipCache: fresh,
    });
    return data;
  },
};
