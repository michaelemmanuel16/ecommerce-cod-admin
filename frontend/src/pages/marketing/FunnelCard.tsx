import { Card, Select } from '../../components/ui-v2';
import type { Funnel, ProductRow } from '../../services/marketing.service';
import { count } from '../reports/format';
import { stepPercent } from './format';

interface Props {
  funnel: Funnel;
  products: ProductRow[];
  productId: number | null;
  onProduct: (id: number | null) => void;
}

/** The funnel row: Meta numbers, then real orders, each with its step-to-step percent. */
export function FunnelCard({ funnel: f, products, productId, onProduct }: Props) {
  const steps = [
    { label: 'Impressions', n: f.impressions, from: null as number | null },
    { label: 'Link clicks', n: f.linkClicks, from: f.impressions },
    { label: 'Landing page views', n: f.landingPageViews, from: f.linkClicks },
    { label: 'Checkouts started', n: f.checkoutsStarted, from: f.landingPageViews },
    { label: 'Orders placed', n: f.ordersPlaced, from: f.checkoutsStarted },
    { label: 'Confirmed', n: f.confirmed, from: f.ordersPlaced },
    { label: 'Delivered', n: f.delivered, from: f.confirmed },
  ];
  return (
    <Card
      title="Funnel"
      aside={
        <Select compact label="Product" value={productId ?? ''} onChange={(e) => onProduct(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">All products</option>
          {products.map((p) => <option key={p.product.id} value={p.product.id}>{p.product.name}</option>)}
        </Select>
      }
    >
      <div className="fn">
        {steps.map((s) => (
          <div className="fs" key={s.label}>
            <span className="fl">{s.label}</span>
            <span className="fc">{count(s.n)}</span>
            <span className="fm">{s.from === null ? '' : `${stepPercent(s.n, s.from)} of the step before`}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
