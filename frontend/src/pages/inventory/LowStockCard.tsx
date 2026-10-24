import { PackageX } from 'lucide-react';
import { Button } from '../../components/ui-v2';
import type { LowStockProduct } from '../../services/inventory.service';
import { num } from './model';

interface LowStockCardProps {
  products: LowStockProduct[];
  canMove: boolean;
  onAllocate: (productId: number) => void;
  onShow: (productId: number) => void;
}

/** Products that run out within their days-of-cover limit (F-211, F-601): the stock keeper's first look. */
export function LowStockCard({ products, canMove, onAllocate, onShow }: LowStockCardProps) {
  if (products.length === 0) return null;
  return (
    <div className="card lowstock">
      <div className="ct"><h3><PackageX aria-hidden="true" />Running low</h3><span>{products.length} {products.length === 1 ? 'product' : 'products'}</span></div>
      <ul className="lowlist">
        {products.slice(0, 5).map((p) => (
          <li key={p.id}>
            <div>
              <b>{p.name}</b>
              <small>
                {num(p.onHandTotal ?? 0)} on hand
                {p.daysOfCover !== null ? `, about ${num(Math.round(p.daysOfCover))} ${Math.round(p.daysOfCover) === 1 ? 'day' : 'days'} left` : ''}
              </small>
            </div>
            <div className="tbtns">
              <Button size="mini" onClick={() => onShow(p.id)}>Show stock</Button>
              {canMove && <Button size="mini" variant="primary" onClick={() => onAllocate(p.id)}>Allocate</Button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
