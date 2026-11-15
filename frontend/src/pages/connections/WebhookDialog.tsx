import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { productsService } from '../../services/products.service';
import { webhooksService } from '../../services/webhooks.service';
import type { Product, Webhook } from '../../types';
import { apiErrorMessage } from '../../utils/apiError';
import { generateApiKey, generateSecret } from '../../utils/webhookValidation';

/** The CodAdmin fields a sender's field can fill (the backend reads these names; anything else goes to the order notes). */
const INTERNAL_FIELDS: Array<[string, string]> = [
  ['customerPhone', 'Phone'], ['alternativePhone', 'Other phone'], ['customerFirstName', 'Customer name'],
  ['customerLastName', 'Last name'], ['customerEmail', 'Email'], ['deliveryAddress', 'Address'],
  ['deliveryState', 'Region'], ['deliveryArea', 'Area'], ['quantity', 'Quantity'], ['package', 'Package'],
  ['price', 'Price'], ['totalAmount', 'Total'], ['notes', 'Notes'],
];

interface Row { external: string; internal: string }

const DEFAULT_ROWS: Row[] = [
  { external: 'customer_name', internal: 'customerFirstName' },
  { external: 'phone_number', internal: 'customerPhone' },
  { external: 'customer_address', internal: 'deliveryAddress' },
  { external: 'region', internal: 'deliveryState' },
  { external: 'quantity', internal: 'quantity' },
];

interface Props {
  open: boolean;
  /** null: create a new webhook. */
  webhook: Webhook | null;
  onClose: () => void;
  onSaved: (saved: Webhook) => void;
}

/** Create or edit a webhook: name, product and the field mapping (their field, our field). Phone is required. */
export function WebhookDialog({ open, webhook, onClose, onSaved }: Props) {
  const say = useToast();
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<Row[]>(DEFAULT_ROWS);
  const [isActive, setIsActive] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(webhook?.name ?? '');
    setProductId(webhook?.productId ? String(webhook.productId) : '');
    setIsActive(webhook?.isActive ?? true);
    setRows(webhook ? Object.entries(webhook.fieldMapping ?? {}).map(([internal, external]) => ({ external: String(external), internal })) : DEFAULT_ROWS);
    setError(null);
    productsService.getProducts().then(setProducts).catch(() => setProducts([]));
  }, [open, webhook]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError('Give the webhook a name.'); return; }
    if (!productId) { setError('Pick the product these orders are for.'); return; }
    const used = rows.filter((r) => r.external.trim() && r.internal);
    if (!used.some((r) => r.internal === 'customerPhone')) { setError('Map the customer phone. Name and phone are required.'); return; }
    if (new Set(used.map((r) => r.internal)).size !== used.length) { setError('Each CodAdmin field can be filled by one field only.'); return; }
    const fieldMapping = Object.fromEntries(used.map((r) => [r.internal, r.external.trim()]));
    setSaving(true);
    try {
      const saved = webhook
        ? await webhooksService.updateWebhook(webhook.id, { name: name.trim(), productId: Number(productId), fieldMapping, isActive })
        : await webhooksService.createWebhook({
            name: name.trim(), url: '', secret: generateSecret(), apiKey: generateApiKey(),
            productId: Number(productId), isActive: true, fieldMapping,
          });
      say(webhook ? 'Webhook saved' : 'Webhook created');
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'The webhook could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={webhook ? 'Edit webhook' : 'New webhook'}
      description="Another form or page can post orders to a private import URL. Say which of its fields goes where."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : webhook ? 'Save' : 'Create webhook'}</Button></>}
    >
      <div className="cxd stack">
        {error && <div className="strip bad" role="alert">{error}</div>}
        <div className="row2">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Landing page C" />
          <Select label="Product" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Pick a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div>
          <span className="lab">Field mapping</span>
          <div className="stack" style={{ gap: 8 }}>
            {rows.map((r, i) => (
              <div className="maprow" key={i}>
                <Input compact label={`Field in their request, row ${i + 1}`} placeholder="Their field, e.g. phone_number" value={r.external} onChange={(e) => setRow(i, { external: e.target.value })} />
                <Select compact label={`Goes to in CodAdmin, row ${i + 1}`} value={r.internal} onChange={(e) => setRow(i, { internal: e.target.value })}>
                  <option value="">Goes to...</option>
                  {INTERNAL_FIELDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </Select>
                <Button size="icon-sm" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}><X /></Button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button onClick={() => setRows((cur) => [...cur, { external: '', internal: '' }])}><Plus />Add a field</Button>
            <span className="hint">Phone is required.</span>
          </div>
        </div>
        {webhook && (
          <label className="accrow">
            <div><b>Accept orders</b><small>Turn this off to stop this URL taking orders.</small></div>
            <input type="checkbox" style={{ marginLeft: 'auto' }} checked={isActive} onChange={(e) => setIsActive(e.target.checked)} aria-label="Accept orders" />
          </label>
        )}
      </div>
    </Modal>
  );
}
