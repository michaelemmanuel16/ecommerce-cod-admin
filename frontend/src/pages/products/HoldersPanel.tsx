import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { Skeleton, Table, Tag } from '../../components/ui-v2';
import { countTag } from '../inventory/model';
import { productsService, type Holders } from '../../services/products.service';
import { holderColumns } from './holderColumns';
import { countNote, noneNote } from './model';

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
          <small>Read only. Allocate, transfer, return and adjust stock in Inventory. Allocated counts the units that reached the holder. Transfers out and adjustments also change on hand. Value is at cost.</small>
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
            <Table label="Stock by holder" columns={holderColumns(data.total)} rows={data.holders} rowKey={(h) => h.locationId} />
          </div>
          {data.holders.map((h) => {
            const note = countNote(h);
            if (!note) return null;
            const tag = countTag({ isOld: false, difference: h.count!.difference ?? 0, wording: 'off' });
            return <p className="exnote" key={h.locationId}><Tag tone={tag.tone}>{tag.text}</Tag> {note}</p>;
          })}
          {noneNote(data.holdersWithNone) && <p className="exnote">{noneNote(data.holdersWithNone)}</p>}
        </>
      )}
    </div>
  );
}
