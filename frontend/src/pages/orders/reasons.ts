import type { DeclineReason, FailureReason, OrderStatus } from '../../types';

export const DECLINE_REASONS: Array<[DeclineReason, string]> = [
  ['price_too_high', 'Price too high'],
  ['prank_or_mistake', 'Prank or mistake'],
  ['changed_mind', 'Changed their mind'],
  ['bought_elsewhere', 'Bought elsewhere'],
  ['wrong_number', 'Wrong number'],
  ['other', 'Other'],
];

export const FAILURE_REASONS: Array<[FailureReason, string]> = [
  ['not_reachable', 'Not reachable'],
  ['refused', 'Refused'],
  ['wrong_address', 'Wrong address'],
  ['rescheduled', 'Rescheduled'],
  ['other', 'Other'],
];

/** The label for a failure reason id; an unknown id shows as it is. */
export const failureReasonLabel = (reason: string): string => FAILURE_REASONS.find(([id]) => id === reason)?.[1] ?? reason;

/** Which dialog a move to this status opens (F-306): a cancel asks why, a failed delivery asks why and when next. */
type ReasonKind = 'decline' | 'failure';
export const reasonKind = (target: OrderStatus): ReasonKind | null =>
  target === 'cancelled' ? 'decline' : target === 'failed_delivery' ? 'failure' : null;
