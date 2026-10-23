/** The wa.me link of a phone number ("+233 24 555 0103" gives https://wa.me/233245550103). Null when there are no digits. */
export const whatsappUrl = (number?: string | null): string | null => {
  const digits = (number || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
};
