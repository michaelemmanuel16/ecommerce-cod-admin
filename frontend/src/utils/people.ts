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
