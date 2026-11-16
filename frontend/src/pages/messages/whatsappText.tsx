import type { ReactNode } from 'react';

// WhatsApp bold: *text* on one line, with the asterisks touching non-space. Nothing else is formatted.
const BOLD = /\*([^\s*](?:[^*\n]*[^\s*])?)\*/g;

/** The text with each *bold* run as a <strong> element. React elements only, so the text can never inject markup. */
export function renderWhatsAppText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<strong key={at}>{m[1]}</strong>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
