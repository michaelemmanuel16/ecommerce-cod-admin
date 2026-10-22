/** Name and avatar helpers shared by the Orders and Customers screens. */

export const personName = (u: { firstName: string; lastName: string }): string => `${u.firstName} ${u.lastName}`.trim();

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** Avatar tint per customer, the five tones of TONE in the mockup. */
export const AVATAR_TONES = ['pine', 'gold', 'violet', 'coral', 'mint'] as const;
