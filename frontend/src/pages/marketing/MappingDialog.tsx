import { useEffect, useState } from 'react';
import { Button, Modal, Select, useToast } from '../../components/ui-v2';
import { marketingService } from '../../services/marketing.service';
import { productsService } from '../../services/products.service';
import type { Product } from '../../types';
import { apiMessage } from '../orders/importText';

/** One campaign the dialog can map. `spend` is already formatted. */
export interface MapTarget {
  adAccountId: number;
  campaignId: string;
  campaignName: string;
  spend: string;
  product: { id: number; name: string; archived: boolean; via?: 'campaign' | 'prefix' } | null;
}

interface Props {
  /** Campaigns to choose from: one from a table row, the unmapped ones from the strip. Empty closes the dialog. */
  targets: MapTarget[];
  onClose: () => void;
  /** Called after a save: the page refetches. */
  onSaved: () => void;
}

const keyOf = (t: MapTarget) => `${t.adAccountId}:${t.campaignId}`;
/** "MG_Oct_Teacher" -> "MG_". With no underscore the whole name. */
const prefixOf = (name: string): string => { const i = name.indexOf('_'); return i === -1 ? name : name.slice(0, i + 1); };

/** Map a campaign to a product: one campaign (PUT) or every campaign with a name prefix (POST a rule). */
export function MappingDialog({ targets, onClose, onSaved }: Props) {
  const say = useToast();
  const [key, setKey] = useState(targets[0] ? keyOf(targets[0]) : '');
  const target = targets.find((t) => keyOf(t) === key) ?? targets[0];
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState('');
  const [scope, setScope] = useState<'campaign' | 'prefix'>('campaign');
  const [prefix, setPrefix] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    productsService.getProducts().then((p) => { if (live) setProducts(p.filter((x) => x.isActive)); }, () => { if (live) setProducts([]); });
    return () => { live = false; };
  }, []);

  // A new campaign starts the form again, with the prefix from its name
  const name = target?.campaignName ?? '';
  useEffect(() => { setPrefix(prefixOf(name)); setProductId(target?.product && !target.product.archived ? String(target.product.id) : ''); setScope('campaign'); setError(''); }, [key, name]);

  if (!target) return null;

  const run = async (work: () => Promise<void>, done = 'Mapping saved') => {
    setSaving(true);
    setError('');
    try {
      await work();
      say(done);
      onSaved();
      onClose();
    } catch (err) {
      setError(await apiMessage(err, 'The mapping was not saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const save = () => run(() => (scope === 'campaign'
    ? marketingService.setPick({ adAccountId: target.adAccountId, campaignId: target.campaignId, productId: Number(productId) })
    : marketingService.addRule({ prefix: prefix.trim(), productId: Number(productId) })));
  const remove = () => run(() => marketingService.setPick({ adAccountId: target.adAccountId, campaignId: target.campaignId, productId: null }), 'Mapping removed');
  const ready = productId !== '' && (scope === 'campaign' || prefix.trim() !== '');

  return (
    <Modal
      open onClose={onClose} title="Map a campaign to a product"
      description={<>{target.campaignName} spent {target.spend}.</>}
      footer={<>
        {target.product?.via === 'campaign' && <Button onClick={() => void remove()} disabled={saving}>Remove mapping</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !ready}>Save mapping</Button>
      </>}
    >
      {targets.length > 1 && (
        <Select label="Campaign" value={keyOf(target)} onChange={(e) => setKey(e.target.value)}>
          {targets.map((t) => <option key={keyOf(t)} value={keyOf(t)}>{t.campaignName} ({t.spend})</option>)}
        </Select>
      )}
      {target.product?.archived && <p className="err" role="alert">{target.product.name} is archived. Pick an active product for this campaign.</p>}
      {target.product && !target.product.archived && <p className="hint">Now mapped to {target.product.name}.</p>}
      <Select label="Product" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={products === null}>
        <option value="">Choose a product</option>
        {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <fieldset className="mapscope">
        <legend className="sr">Apply to</legend>
        <div className="prefixrow">
          <input type="radio" id="mapscope-campaign" name="scope" checked={scope === 'campaign'} onChange={() => setScope('campaign')} />
          <label htmlFor="mapscope-campaign">Only this campaign</label>
        </div>
        <div className="prefixrow">
          <input type="radio" id="mapscope-prefix" name="scope" checked={scope === 'prefix'} onChange={() => setScope('prefix')} />
          <label htmlFor="mapscope-prefix">All campaigns whose name starts with</label>
          <input type="text" className="prefixin" aria-label="Name starts with" value={prefix} maxLength={40} onChange={(e) => setPrefix(e.target.value)} />
        </div>
      </fieldset>
      {error && <p className="err" role="alert">{error}</p>}
    </Modal>
  );
}
