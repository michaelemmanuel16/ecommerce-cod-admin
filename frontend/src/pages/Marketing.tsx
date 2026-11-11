import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Megaphone } from 'lucide-react';
import { EmptyState, Select, Skeleton } from '../components/ui-v2';
import { useV2Page } from '../components/shell/useV2Page';
import { usePermissions } from '../hooks/usePermissions';
import { formatRelativeTime } from '../utils/format';
import { BlockError } from './dashboard/blocks/Frame';
import { Part } from './financial/profit/Part';
import { refreshBlocks } from './financial/profit/useBlock';
import { CampaignsCard } from './marketing/CampaignsCard';
import { FunnelCard } from './marketing/FunnelCard';
import { useAccounts, useCampaigns, useFunnel, useProducts, useSummary, useUnmapped } from './marketing/blocks';
import { MappingDialog, type MapTarget } from './marketing/MappingDialog';
import { amount, money } from './marketing/format';
import { PERIODS, periodRange, type Period } from './marketing/range';
import { ProductsCard } from './marketing/ProductsCard';
import { Tiles } from './marketing/Tiles';
import { UnmappedStrip } from './marketing/UnmappedStrip';
import { rangeLabel } from './reports/format';
import type { CampaignRow, Unmapped } from '../services/marketing.service';

/**
 * Marketing (M8-T14, COD-74), built from docs/mockups/v2/marketing.html: Meta ad results by product, from ad click to
 * delivered order. The page does no KPI arithmetic: every figure, status and message comes from the API. The agent
 * cards, the agent drawer and the daily chart are later milestones.
 */
export function Marketing() {
  useV2Page();
  const [period, setPeriod] = useState<Period>('month');
  const [productId, setProductId] = useState<number | null>(null);
  const [mapping, setMapping] = useState<MapTarget[] | null>(null);
  const { can } = usePermissions();
  const canMap = can('marketing', 'update');
  const range = periodRange(period);

  const accounts = useAccounts();
  // With no Meta account nothing else is asked
  const connected = accounts.status === 'ready' && (accounts.data?.length ?? 0) > 0;
  const summary = useSummary(range, connected);
  const funnel = useFunnel(range, productId, connected);
  const products = useProducts(range, connected);
  const campaigns = useCampaigns(range, connected);
  const unmapped = useUnmapped(range, connected);

  if (accounts.status === 'failed') return <section className="mkt"><BlockError name="Meta accounts" onRetry={accounts.retry} /></section>;
  if (accounts.data === undefined) return <section className="mkt" aria-busy="true" aria-label="Loading Marketing"><Skeleton height={160} className="skelcard" /></section>;

  const head = (
    <div className="head">
      <div><h1>Marketing</h1><p>Meta ad results by product, from ad click to delivered order.</p></div>
    </div>
  );
  if (accounts.data.length === 0) {
    return (
      <section className="mkt">
        {head}
        <div className="card">
          <EmptyState
            icon={<Megaphone />} title="Meta Ads is not connected"
            text="Connect your ad account to see spend, CPA and delivered orders by product."
            action={<Link className="btn pri" to="/settings?tab=integrations&section=meta-ads">Connect Meta Ads</Link>}
          />
        </div>
      </section>
    );
  }

  const live = accounts.data.some((a) => a.status === 'connected');
  const pulled = accounts.data.map((a) => a.lastPulledAt).filter((d): d is string => !!d).sort().pop();
  const label = rangeLabel(range.from, range.to);
  const rowTarget = (r: CampaignRow): MapTarget => ({ adAccountId: r.adAccountId, campaignId: r.campaignId, campaignName: r.campaignName, spend: money(r.spend), product: r.product });
  const stripTargets = (u: Unmapped): MapTarget[] => u.campaigns.map((c) => ({ adAccountId: c.adAccountId, campaignId: c.campaignId, campaignName: c.campaignName, spend: amount(c.spend, c.currency), product: null }));
  const busy = [summary, funnel, products, campaigns].some((b) => b.status === 'loading' && b.data !== undefined);

  return (
    <section className={clsx('mkt', busy && 'busy')}>
      <div className="head">
        <div><h1>Marketing</h1><p>Meta ad results by product, from ad click to delivered order.</p></div>
        <div className="hd-actions">
          <span className="conn"><i className={live ? undefined : 'off'} />Meta account: {live ? 'connected' : 'disconnected'}{pulled && <small>, pulled {formatRelativeTime(pulled)}</small>}</span>
          <Select compact label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </div>
      </div>

      <Part name="Marketing tiles" block={summary} height={150}>{(s) => <Tiles s={s} />}</Part>
      <Part name="Funnel" block={funnel} height={140}>
        {(f) => <FunnelCard funnel={f} products={products.data ?? []} productId={productId} onProduct={setProductId} />}
      </Part>
      <Part name="Products" block={products} height={160}>{(rows) => <ProductsCard rows={rows} rangeText={label} />}</Part>
      {unmapped.data && <UnmappedStrip unmapped={unmapped.data} onMap={canMap ? () => setMapping(stripTargets(unmapped.data!)) : undefined} />}
      <Part name="Campaigns" block={campaigns} height={260}>
        {(c) => <CampaignsCard rows={c.campaigns} totals={c.totals} rangeText={label} onMap={canMap ? (r) => setMapping([rowTarget(r)]) : undefined} />}
      </Part>
      {mapping && <MappingDialog targets={mapping} onClose={() => setMapping(null)} onSaved={refreshBlocks} />}
    </section>
  );
}
