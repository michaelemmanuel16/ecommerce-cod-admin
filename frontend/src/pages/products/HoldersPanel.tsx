import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { Skeleton } from '../../components/ui-v2';
import { productsService, type Holders } from '../../services/products.service';
import { formatCurrency } from '../../utils/format';
import { countNote, HOLDER_TYPE, noneNote } from './model';

/**
 * Stock by holder of one product (F-603), read only. Allocating, transferring, returning and adjusting happen in Inventory:
 * this panel only links there. Notes say where a count differs from our records and who holds none.
 */
export function HoldersPanel({ productId }: { productId: number }) {
  const [data, setData] = useState<Holders | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    productsService.holders(productId).then((d) => live && setData(d), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [productId]);

  return (
    <div className="exin">
      <div className="exhead">
        <div>
          <b>Stock by holder</b>
          <small>Read only. Allocate, transfer, return and adjust stock in Inventory. On hand is allocated minus in transit, delivered and returned. Value is at cost.</small>
        </div>
        <div className="exbtns">
          <Link className="mini pri" to={`/inventory?product=${productId}`} style={{ textDecoration: 'none' }}>
            <Boxes style={{ width: 14, height: 14, verticalAlign: -2 }} /> Open in Inventory
          </Link>
        </div>
      </div>
      {failed ? (
        <p className="exnote">The stock by holder could not load.</p>
      ) : !data ? (
        <div aria-busy="true" aria-label="Loading stock by holder">
          <Skeleton height={36} />
          <Skeleton height={36} className="skelgap" />
        </div>
      ) : (
        <>
          <div className="hold">
            <div className="tablewrap">
              <table aria-label="Stock by holder">
                <thead>
                  <tr>
                    <th>Holder</th>
                    <th className="r">Allocated</th>
                    <th className="r">In transit</th>
                    <th className="r">Delivered</th>
                    <th className="r">Returned</th>
                    <th className="r">On hand</th>
                    <th className="r">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holders.map((h) => (
                    <tr key={h.locationId}>
                      <td>
                        <b>{h.name}</b>
                        <small>{HOLDER_TYPE[h.type]}</small>
                      </td>
                      <td className="r num">{h.allocated}</td>
                      <td className="r num">{h.inTransit > 0 ? h.inTransit : <span style={{ color: 'var(--ink-3)' }}>0</span>}</td>
                      <td className="r num">{h.delivered}</td>
                      <td className="r num">{h.returned}</td>
                      <td className="r num"><b>{h.onHand}</b></td>
                      <td className="r num">{formatCurrency(h.value)}</td>
                    </tr>
                  ))}
                  <tr className="tot">
                    <td>Total</td>
                    <td className="r num">{data.total.allocated}</td>
                    <td className="r num">{data.total.inTransit}</td>
                    <td className="r num">{data.total.delivered}</td>
                    <td className="r num">{data.total.returned}</td>
                    <td className="r num">{data.total.onHand}</td>
                    <td className="r num">{formatCurrency(data.total.value)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          {data.holders.map((h) => {
            const note = countNote(h);
            return note ? <p className="exnote" key={h.locationId}>{note}</p> : null;
          })}
          {noneNote(data.holdersWithNone) && <p className="exnote">{noneNote(data.holdersWithNone)}</p>}
        </>
      )}
    </div>
  );
}
