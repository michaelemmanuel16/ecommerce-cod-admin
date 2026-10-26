import apiClient from './api';

/** The manual partner payout API (backend partnerSettlementRoutes.ts, F-908). Money arrives as numbers (the client normalizes it) and goes out as strings. */

/** One order the amount would pay, oldest first. */
export interface ManualPreviewOrder {
  orderId: number;
  applied: string | number;
  clearsOrder: boolean;
}

/** POST /api/partner-settlements/manual/preview: the FIFO plan with no write. */
export interface ManualPayoutPreview {
  partnerId: number;
  amount: string | number;
  unpaidTotal: string | number;
  appliedAmount: string | number;
  unappliedAmount: string | number;
  leftUnpaid: string | number;
  orders: ManualPreviewOrder[];
  warnings: string[];
}

/** POST /api/partner-settlements/manual. The server takes no method field, so the form puts the method in `notes`. */
export interface ManualPayoutBody {
  partnerId: number;
  amount: string;
  reference: string;
  payoutDate?: string;
  notes?: string;
}

export interface ManualPayoutSaved {
  id: number;
  reference: string;
  payoutAmount: string | number;
  unappliedAmount: string | number;
  warnings: string[];
}

// `quiet`: the modal shows a refusal ("This reference was used on ...") itself, so the client raises no second toast.
export const partnerSettlementsService = {
  async previewManual(partnerId: number, amount: string): Promise<ManualPayoutPreview> {
    const response = await apiClient.post('/api/partner-settlements/manual/preview', { partnerId, amount }, { quiet: true });
    return response.data.preview;
  },

  async recordManual(body: ManualPayoutBody): Promise<ManualPayoutSaved> {
    const response = await apiClient.post('/api/partner-settlements/manual', body, { quiet: true });
    return response.data.settlement;
  },
};
