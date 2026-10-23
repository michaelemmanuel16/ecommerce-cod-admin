/** Lowercase letters and digits joined by single hyphens. Callers add their own fallback for an empty result. */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
