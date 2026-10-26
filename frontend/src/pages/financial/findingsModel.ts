import type { FindingStatus, FindingType } from '../../services/findings.service';
import type { TagTone } from '../../components/ui-v2';

export const TYPE_LABEL: Record<FindingType, string> = {
  ledger_gap: 'Ledger gap',
  stock_gap: 'Stock gap',
  short_pay: 'Short payment',
  cash_gap: 'Cash gap',
  unpaid_term: 'Unpaid past terms',
  repeat_refuser: 'Repeat refuser',
  payment_unmatched: 'Payment not matched',
  ledger_post_failed: 'Ledger post failed',
  paystack_unsettled: 'Paystack not settled',
  fee_rule_missing: 'Delivery fee rule missing',
  unmatched_line: 'Payout line not matched',
  charge_variance: 'Charge differs from fee rule',
  over_pay: 'Paid more than expected',
  excess_deposit: 'Extra deposit',
  negative_cash_held: 'Cash held below zero',
  verify_exceeds_cash_held: 'Verify refused: above cash held',
};

export const STATUS_LABEL: Record<FindingStatus, string> = { open: 'Open', explained: 'Explained', closed: 'Closed', written_off: 'Written off' };
export const STATUS_TONE: Record<FindingStatus, TagTone> = { open: 'warn', explained: 'ok', closed: 'n', written_off: 'v' };
