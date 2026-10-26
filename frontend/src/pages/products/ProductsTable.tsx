import { Fragment, useState } from 'react';
import clsx from 'clsx';
import { BookOpen, ChevronRight, FileText, Package, Pencil, PenTool } from 'lucide-react';
import { Button, Tag } from '../../components/ui-v2';
import type { ProductRow } from '../../services/products.service';
import { formatCurrency } from '../../utils/format';
import { toneOf } from '../deliveries/model';
import { Dash } from './Dash';
import { HoldersPanel } from './HoldersPanel';
import { coverText, pct, STATUS_TAG } from './model';

interface ProductsTableProps {
  rows: ProductRow[];
  /** Show Cost and Margin only when the API sent them for this role. */
  showCost: boolean;
  /** Delivery success target in percent, from the server (null when this role gets no summary). */
  target: number | null;
  monthLabel: string;
  canEdit: boolean;
  onEdit: (id: number) => void;
}

const PHYSICAL_ICONS = [BookOpen, PenTool, Package] as const;

/** The product image, or a round icon in a tone chosen by the product's id. Archived products are grey. */
function Thumb({ row }: { row: ProductRow }) {
  if (row.imageUrl) return <div className="pimg"><img src={row.imageUrl} alt="" /></div>;
  const Icon = row.productType === 'digital' ? FileText : PHYSICAL_ICONS[row.id % PHYSICAL_ICONS.length];
  return <div className={clsx('pimg', row.isActive && toneOf(row.id))}><Icon size={18} /></div>;
}

/**
 * The Products table (F-600) with the stock-by-holder expansion (F-603). One row open at a time. It is not the shared Table:
 * that one has no slot for a detail row under a row. Cost and margin columns follow the API: a role that gets no cost sees none.
 */
export function ProductsTable({ rows, showCost, target, monthLabel, canEdit, onEdit }: ProductsTableProps) {
  const [open, setOpen] = useState<number | null>(null);
  const cols = 7 + (showCost ? 2 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="tablewrap">
      <table className="pt" aria-label="Products">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th className="r">Price</th>
            {showCost && <th className="r">Cost</th>}
            {showCost && <th className="r">Margin</th>}
            <th className="r">Stock</th>
            <th className="r">Delivered in {monthLabel}</th>
            <th className="r">Delivery success</th>
            <th>Status</th>
            {canEdit && <th className="r">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const expanded = open === p.id;
            const tag = STATUS_TAG[p.status];
            const cover = coverText(p);
            const low = target !== null && p.deliverySuccess !== null && p.deliverySuccess < target;
            return (
              <Fragment key={p.id}>
                <tr className={clsx(!p.isActive && 'arch')}>
                  <td>
                    <div className="who">
                      <button
                        type="button"
                        className="xbtn"
                        aria-expanded={expanded}
                        aria-label={p.productType === 'digital' ? `Show details of ${p.name}` : `Show stock by holder of ${p.name}`}
                        onClick={() => setOpen(expanded ? null : p.id)}
                      >
                        <ChevronRight />
                      </button>
                      <Thumb row={p} />
                      <div>
                        <b>{p.name}</b>
                        {p.productType === 'digital' && <small>Digital · sent by WhatsApp</small>}
                      </div>
                    </div>
                  </td>
                  <td className="sku">{p.sku}</td>
                  <td className="r num">{formatCurrency(p.price)}</td>
                  {showCost && <td className="r num">{p.cogs == null || Number(p.cogs) === 0 ? <Dash /> : formatCurrency(p.cogs)}</td>}
                  {showCost && <td className="r num"><b>{pct(p.marginPct)}</b></td>}
                  <td className="r num">
                    <b>{p.onHandTotal === null ? '—' : p.onHandTotal}</b>
                    {cover && <small>{cover}</small>}
                  </td>
                  <td className="r num">{p.deliveredInPeriod > 0 ? p.deliveredInPeriod : <Dash />}</td>
                  <td className="r">{p.deliverySuccess === null ? <Dash /> : <span className={clsx('num', low && 'low')}><b>{pct(p.deliverySuccess)}</b></span>}</td>
                  <td><Tag tone={tag.tone}>{tag.label}</Tag></td>
                  {canEdit && (
                    <td className="r">
                      <Button size="icon-sm" aria-label={`Edit ${p.name}`} title="Edit product" onClick={() => onEdit(p.id)}>
                        <Pencil />
                      </Button>
                    </td>
                  )}
                </tr>
                {expanded && (
                  <tr className="exp">
                    <td colSpan={cols}>
                      {p.productType === 'digital' ? (
                        <div className="exin">
                          <div className="digi">
                            <div className="ic"><FileText size={18} /></div>
                            <div>
                              <b>Digital product, no stock to track</b>
                              <p>
                                Sent as a link by WhatsApp after the order is paid. The link expires after {p.downloadLinkExpiryHours ?? 72} hours and can be used {p.maxDownloads ?? 5} times.
                                {' '}{p.deliveredInPeriod} sent in {monthLabel}.
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <HoldersPanel productId={p.id} />
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
