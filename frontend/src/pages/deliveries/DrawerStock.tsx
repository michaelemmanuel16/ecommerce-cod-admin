import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deliveryPartnersService, type PartnerDetail, type StockLevelRow } from '../../services/delivery-partners.service';
import { ListSkeleton } from './ListSkeleton';
import { count } from './model';

interface DrawerStockProps {
  location: PartnerDetail['stockLocation'];
}

/**
 * Stock tab (F-651): what the partner's stock location holds, from /api/inventory/levels, with a link to the Inventory page for
 * that location. A role that may not read stock sees a plain note instead.
 */
export function DrawerStock({ location }: DrawerStockProps) {
  const [levels, setLevels] = useState<StockLevelRow[] | null>(null);
  /** null: the role may not read stock (403). */
  const [refused, setRefused] = useState(false);
  const [failed, setFailed] = useState(false);
  const locationId = location?.id ?? null;

  useEffect(() => {
    if (locationId === null) return;
    let live = true;
    setLevels(null);
    setRefused(false);
    setFailed(false);
    deliveryPartnersService.stockLevels(locationId).then(
      (r) => live && (r === null ? setRefused(true) : setLevels(r)),
      () => live && setFailed(true),
    );
    return () => { live = false; };
  }, [locationId]);

  if (!location) return <p className="mut">This partner has no stock location.</p>;
  if (refused) return <p className="mut">Stock figures are not shown to your role.</p>;
  if (failed) return <p className="mut">The stock could not load.</p>;
  if (!levels) return <ListSkeleton label="Loading stock" />;

  const sum = (pick: (l: StockLevelRow) => number) => levels.reduce((s, l) => s + pick(l), 0);
  return (
    <div className="dstock">
      <div className="dfig">
        <div><span>On hand</span><b className="num">{count(sum((l) => l.onHand))}</b></div>
        <div><span>Reserved</span><b className="num">{count(sum((l) => l.reserved))}</b></div>
        <div><span>In transit to them</span><b className="num">{count(sum((l) => l.inTransit))}</b></div>
      </div>
      {levels.length === 0 ? (
        <p className="mut">{location.name} holds no stock.</p>
      ) : (
        <ul className="dolist" aria-label={`Stock at ${location.name}`}>
          {levels.map((l) => (
            <li key={l.productId}>
              <div className="dorow">
                <div className="domain"><b>{l.productName}</b><small>{l.sku}</small></div>
                <div className="doside"><span className="num">{count(l.onHand)} on hand</span><small>{count(l.reserved)} reserved</small></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link to={`/inventory?location=${location.id}`}>See {location.name} in Inventory</Link>
    </div>
  );
}
