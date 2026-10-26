import apiClient from './api';

/** The manual partner payout API (backend partnerSettlementRoutes.ts, F-908). The client turns money strings into numbers; money goes out as a string. */

/** One order the amount would pay, oldest first. */
export interface ManualPreviewOrder {
  orderId: number;
  applied: number;
  clearsOrder: boolean;
}

/** POST /api/partner-settlements/manual/preview: the FIFO plan with no write. */
export interface ManualPayoutPreview {
  unpaidTotal: number;
  appliedAmount: number;
  unappliedAmount: number;
  leftUnpaid: number;
  orders: ManualPreviewOrder[];
}

/** POST /api/partner-settlements/manual. */
export interface ManualPayoutBody {
  partnerId: number;
  amount: string;
  reference: string;
  payoutDate?: string;
}

export interface ManualPayoutSaved {
  unappliedAmount: number;
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
