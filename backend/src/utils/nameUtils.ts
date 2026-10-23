/** "First Last" with the edges trimmed; empty for a missing person. */
export const fullName = (u: { firstName: string; lastName: string } | null | undefined): string =>
  (u ? `${u.firstName} ${u.lastName}`.trim() : '');
