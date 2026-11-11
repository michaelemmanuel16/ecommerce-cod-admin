import { Card, Table, Tag, type Column, type TagTone } from '../../components/ui-v2';
import type { CampaignRow, CampaignStatus, CampaignTotals } from '../../services/marketing.service';
import { count } from '../reports/format';
import { money } from './format';

const TONE: Record<CampaignStatus, TagTone> = {
  Winning: 'ok', 'On track': 'n', 'Over max CPA': 'bad', 'Not mapped': 'warn', Paused: 'n',
};

interface Props {
  rows: CampaignRow[];
  totals: CampaignTotals;
  rangeText: string;
  /** Set for a user with marketing:update: opens the mapping dialog for a campaign. */
  onMap?: (row: CampaignRow) => void;
}

/** Campaign table from GET /campaigns/performance, with the totals row. */
export function CampaignsCard({ rows, totals, rangeText, onMap }: Props) {
  const num = (n: number) => <span className="num">{count(n)}</span>;
  const columns: Column<CampaignRow>[] = [
    { key: 'name', header: 'Campaign', total: 'Total', render: (r) => <b>{r.campaignName}</b> },
    {
      key: 'product', header: 'Product',
      render: (r) => {
        const label = r.product ? r.product.name : 'Not mapped';
        if (!onMap) return <>{label}{r.product?.archived && <small> archived</small>}</>;
        return (
          <button type="button" className="linkbtn" aria-label={`${r.product ? 'Change product of' : 'Map'} ${r.campaignName}`} onClick={() => onMap(r)}>
            {label}{r.product?.archived && <small> archived</small>}
          </button>
        );
      },
    },
    { key: 'spend', header: 'Spend', right: true, total: <span className="num">{money(totals.spend)}</span>, render: (r) => <span className="num">{money(r.spend)}</span> },
    { key: 'imp', header: 'Impressions', right: true, total: num(totals.impressions), render: (r) => num(r.impressions) },
    { key: 'clicks', header: 'Link clicks', right: true, total: num(totals.linkClicks), render: (r) => num(r.linkClicks) },
    { key: 'lpv', header: 'Landing page views', right: true, total: num(totals.landingPageViews), render: (r) => num(r.landingPageViews) },
    { key: 'co', header: 'Checkouts started', right: true, total: num(totals.checkoutsStarted), render: (r) => num(r.checkoutsStarted) },
    { key: 'pur', header: 'Meta purchases', right: true, total: num(totals.purchases), render: (r) => num(r.purchases) },
    { key: 'cpa', header: 'CPA', right: true, total: <span className="num">{money(totals.cpa)}</span>, render: (r) => <span className="num">{money(r.cpa)}</span> },
    { key: 'max', header: 'Max CPA', right: true, render: (r) => <span className="num">{r.maxCpa?.maxCpa ? money(r.maxCpa.maxCpa) : '-'}</span> },
    {
      key: 'proj', header: 'Projected delivered (Meta purchases)', right: true,
      total: <span className="num">{Number(totals.projectedDelivered.toFixed(1))}</span>,
      render: (r) => <span className="num">{r.projectedDelivered === null ? '-' : r.projectedDelivered}</span>,
    },
    {
      key: 'status', header: 'Status',
      render: (r) => (
        <>
          {r.status === null
            ? <span className="ink3">{r.maxCpa?.message ?? '-'}</span>
            : r.status === 'Not mapped' && onMap
              ? <button type="button" className="chipbtn" aria-label={`Map ${r.campaignName} to a product`} onClick={() => onMap(r)}><Tag tone="warn">Not mapped</Tag></button>
              : <Tag tone={TONE[r.status]}>{r.status}</Tag>}
          {r.lowData && <Tag tone="warn" className="lowtag">Low data</Tag>}
        </>
      ),
    },
  ];
  return (
    <Card title="Campaigns" aside={rangeText} className="mktcamp">
      {rows.length === 0
        ? <p className="note">No campaign has spend in these dates.</p>
        : <Table label="Campaigns" className="dt camp" columns={columns} rows={rows} rowKey={(r) => `${r.adAccountId}:${r.campaignId}`} />}
      <p className="note">Max CPA is profit per delivered order before ads times the product's yield. Status compares CPA with that max CPA.</p>
    </Card>
  );
}
