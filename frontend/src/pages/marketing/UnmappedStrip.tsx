import { Button } from '../../components/ui-v2';
import type { Unmapped } from '../../services/marketing.service';
import { plural } from '../reports/format';
import { amount } from './format';

/** "₦41,000 Meta spend has no product. 2 campaigns are not mapped." The button shows only for a user who may map. */
export function UnmappedStrip({ unmapped, onMap }: { unmapped: Unmapped; onMap?: () => void }) {
  const n = unmapped.campaigns.length;
  if (n === 0) return null;
  const total = Object.entries(unmapped.spendByCurrency).map(([currency, value]) => amount(value, currency)).join(' and ');
  return (
    <div className="mktstrip" role="status">
      <span>{total} Meta spend has no product. {plural(n, 'campaign')} {n === 1 ? 'is' : 'are'} not mapped.</span>
      {onMap && <Button variant="primary" size="mini" onClick={onMap}>Map campaigns</Button>}
    </div>
  );
}
