/** Name and avatar helpers shared by the Orders and Customers screens. */

export const personName = (u: { firstName: string; lastName: string }): string => `${u.firstName} ${u.lastName}`.trim();

/** First and last name initials: "Ama Kofi Mensah" -> "AM", "Ama" -> "A". */
export const initials = (name: string): string => {
  const words = name.split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((w) => w[0]).join('').toUpperCase();
};

/** Avatar tint per customer, the five tones of TONE in the mockup. */
export const AVATAR_TONES = ['pine', 'gold', 'violet', 'coral', 'mint'] as const;

/**
 * The class of an avatar: a tint per id from `tones` (a page with its own list passes it; [''] gives no tint), square for a company,
 * violet for an AI agent. Any other kind gets the tint alone.
 */
export const avatarClass = (kind: string, id: number, tones: readonly string[] = AVATAR_TONES): string =>
  ['a', tones[id % tones.length], kind === 'company' ? 'co' : kind === 'ai_agent' ? 'ai' : ''].filter(Boolean).join(' ');
