/** "First Last" with the edges trimmed; empty for a missing person. */
export const fullName = (u: { firstName: string; lastName: string } | null | undefined): string =>
  (u ? `${u.firstName} ${u.lastName}`.trim() : '');

/** "Kofi Mensah" gives first "Kofi", last "Mensah"; one word is both names (the last name is required). */
export const splitName = (name: string): { firstName: string; lastName: string } => {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') || firstName };
};
