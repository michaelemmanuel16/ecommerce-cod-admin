import { FailureReason } from '@prisma/client';

/**
 * Maps the free text of a failed or returned delivery to the FailureReason list (F-705, M4-T18).
 * Obvious words only; anything else is `other`. Order matters: the first rule that matches wins, so
 * "refused, call later" is a refusal and "wrong address, reschedule" is a wrong address.
 */
const RULES: Array<[FailureReason, RegExp]> = [
  ['refused', /\b(refus\w*|declin\w*|reject\w*|denied|not interested|do(?:es)?n'?t want|did not want|changed (?:his|her|their) mind|changed mind)\b/i],
  ['wrong_address', /\b(wrong (?:address|location)|incorrect (?:address|location)|invalid address|address (?:not|is wrong|incomplete)|(?:can'?t|cannot|could not|couldn'?t|unable to) (?:find|locate)|location not found|not found at)\b/i],
  ['not_reachable', /\b(not reachable|unreachable|no answer|not answering|did not (?:pick|answer)|didn'?t (?:pick|answer)|not picking|never picked|switched off|phone (?:is )?off|(?:can'?t|cannot|could not|couldn'?t|unable to) (?:reach|get through)|no response|unanswered|voicemail)\b/i],
  ['rescheduled', /\b(re-?schedul\w*|postpon\w*|another day|next week|tomorrow|later date)\b/i],
];

/** The reason for one piece of text, or `other` when no rule matches. Empty text is `other`. */
export function mapFailureText(text: string | null | undefined): FailureReason {
  const value = (text ?? '').trim();
  if (!value) return 'other';
  for (const [reason, pattern] of RULES) if (pattern.test(value)) return reason;
  return 'other';
}
