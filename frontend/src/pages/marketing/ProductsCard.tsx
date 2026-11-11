import { Card, Table, Tag, type Column } from '../../components/ui-v2';
import type { ProductRow } from '../../services/marketing.service';
import { count, wholePercent } from '../reports/format';
import { money } from './format';

/** Per-product rows from GET /products. */
export function ProductsCard({ rows, rangeText }: { rows: ProductRow[]; rangeText: string }) {
  const columns: Column<ProductRow>[] = [
    { key: 'p', header: 'Product', render: (r) => <><b>{r.product.name}</b>{r.product.archived && <small> archived</small>}</> },
    { key: 'spend', header: 'Spend', right: true, render: (r) => <span className="num">{money(r.spend)}</span> },
    { key: 'purchases', header: 'Meta purchases', right: true, render: (r) => <span className="num">{count(r.purchases)}</span> },
    { key: 'placed', header: 'Placed', right: true, render: (r) => <span className="num">{count(r.ordersPlaced)}</span> },
    { key: 'confirmed', header: 'Confirmed', right: true, render: (r) => <span className="num">{count(r.confirmed)}</span> },
    { key: 'delivered', header: 'Delivered', right: true, render: (r) => <span className="num">{count(r.delivered)}</span> },
    { key: 'yield', header: 'Yield', right: true, render: (r) => <span className="num">{r.yieldPct === null ? '-' : wholePercent(r.yieldPct)}</span> },
    { key: 'max', header: 'Max CPA', right: true, render: (r) => <span className="num">{r.maxCpa.maxCpa ? money(r.maxCpa.maxCpa) : <span className="ink3">{r.maxCpa.message ?? '-'}</span>}</span> },
    { key: 'cpp', header: 'Cost per placed order', right: true, render: (r) => <span className="num">{money(r.costPerPlaced)}</span> },
    { key: 'low', header: '', render: (r) => (r.lowData ? <Tag tone="warn">Low data</Tag> : null) },
  ];
  return (
    <Card title="Products" aside={rangeText}>
      {rows.length === 0
        ? <p className="note">No product has a mapped campaign with spend in these dates.</p>
        : <Table label="Marketing by product" className="dt" columns={columns} rows={rows} rowKey={(r) => r.product.id} />}
    </Card>
  );
}
