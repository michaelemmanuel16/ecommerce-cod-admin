import { CallOutcome } from '../../types';

export const outcomeColors: Record<CallOutcome, string> = {
  [CallOutcome.CONFIRMED]: 'bg-green-100 text-green-800',
  [CallOutcome.RESCHEDULED]: 'bg-blue-100 text-blue-800',
  [CallOutcome.NO_ANSWER]: 'bg-yellow-100 text-yellow-800',
  [CallOutcome.CANCELLED]: 'bg-red-100 text-red-800',
  [CallOutcome.OTHER]: 'bg-gray-100 text-gray-800',
};

export const outcomeLabels: Record<CallOutcome, string> = {
  [CallOutcome.CONFIRMED]: 'Confirmed',
  [CallOutcome.RESCHEDULED]: 'Rescheduled',
  [CallOutcome.NO_ANSWER]: 'No Answer',
  [CallOutcome.CANCELLED]: 'Cancelled',
  [CallOutcome.OTHER]: 'Other',
};
