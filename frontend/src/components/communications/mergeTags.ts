// Only the merge tags that resolve for a bulk blast. Order-scoped tags
// (order_number, order_total, download_url) render empty for a campaign that
// isn't tied to a single order, so they are deliberately omitted here.
export const BULK_MERGE_TAGS: { tag: string; label: string }[] = [
  { tag: 'customer_name', label: 'Customer name' },
  { tag: 'customer_email', label: 'Customer email' },
  { tag: 'store_name', label: 'Store name' },
  { tag: 'unsubscribe_url', label: 'Unsubscribe link' },
];

// Sample values used by the client-side preview so the merchant sees a realistic
// fill without a backend round-trip.
export const SAMPLE_MERGE_VALUES: Record<string, string> = {
  customer_name: 'Ama Mensah',
  customer_email: 'ama.mensah@example.com',
  store_name: 'Your Store',
  unsubscribe_url: 'https://example.com/unsubscribe',
};
