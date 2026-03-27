export const WHATSAPP_TEMPLATE_OPTIONS = [
  { value: 'order_created', label: 'Order Created' },
  { value: 'confirmed', label: 'Order Confirmed' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed_delivery', label: 'Delivery Failed' },
] as const;

export const WHATSAPP_TEMPLATE_LABELS: Record<string, string> =
  Object.fromEntries(WHATSAPP_TEMPLATE_OPTIONS.map(o => [o.value, o.label]));
