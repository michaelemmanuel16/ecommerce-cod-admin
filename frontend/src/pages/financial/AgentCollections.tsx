import { useState } from 'react';
import { Ban, AlarmClock, ClipboardCheck, Hourglass } from 'lucide-react';
import { Button, EmptyState, Skeleton, Tag, Tile, useToast } from '../../components/ui-v2';
import { AgentAgingTab } from '../../components/financial/AgentAgingTab';
import { CashExposureCard } from '../../components/financial/CashExposureCard';
import { CollectionsToVerifyCard } from '../../components/financial/CollectionsToVerifyCard';
import { CollectionActionModal } from '../../components/financial/modals/CollectionActionModal';
import { BlockPartnerModal } from '../../components/financial/modals/BlockPartnerModal';
import { collectionsService, type AgingPartner, type PartnerDeposit } from '../../services/collections.service';
import { financialService } from '../../services/financial.service';
import { useAging, useDeposits } from './profit/blocks';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { ListSkeleton } from '../deliveries/ListSkeleton';
import { lateOf, ordersText, pendingOf } from './collections/model';

/**
 * The Agent collections tab of Finance (F-704, F-910 to F-912, M5-T36), laid out as the v2 mockup: four tiles, cash exposure
 * by partner, agent aging, and the collections to verify. One aging request feeds the tiles, the chart and the table; the
 * pay-ins load beside it. A change in the review modal reloads both.
 */
export function AgentCollections() {
  const say = useToast();
  const aging = useAging();
  const payIns = useDeposits();
  const report = aging.data;
  const deposits = payIns.data;
  const failed = aging.status === 'failed';
  const [reviewing, setReviewing] = useState<PartnerDeposit | null>(null);
  const [blocking, setBlocking] = useState<AgingPartner | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = () => {
    aging.retry();
    payIns.retry();
  };

  /** Runs one call for a partner (its buttons wait meanwhile), says `message` when it works and the server's sentence when it does not. */
  const act = async (p: AgingPartner, run: () => Promise<string>, fallback: string) => {
    setBusyId(p.agentId);
    try {
      say(await run());
      aging.retry();
    } catch (e) {
      say(apiErrorMessage(e, fallback));
    } finally {
      setBusyId(null);
    }
  };
  const remind = (p: AgingPartner) =>
    act(p, async () => ((await collectionsService.remind(p.agentId)).sent
      ? `Reminder sent to ${p.name} on WhatsApp`
      : `WhatsApp is not connected, so the reminder to ${p.name} was saved but not sent`), 'The reminder could not be sent.');
  const unblock = (p: AgingPartner) => act(p, async () => { await collectionsService.unblock(p.agentId); return `${p.name} unblocked`; }, 'The partner could not be unblocked.');

  const exportCsv = async () => {
    try {
      await financialService.downloadAgentAgingCSV();
      say('Agent aging exported');
    } catch {
      say('The report could not be exported.');
    }
  };

  const s = report?.summary;
  // "Overdue, 8 days or more" is the two oldest buckets of the aging report
  const { amount: lateAmount, orders: lateOrders } = lateOf(s?.bucketTotals ?? []);
  const latePartners = report ? report.partners.filter((p) => lateOf(p.buckets).amount > 0) : [];
  const toVerify = deposits ? pendingOf(deposits) : null;
  const toVerifyAmount = (toVerify ?? []).reduce((sum, d) => sum + d.amount, 0);
  const cashHeldOf = (agentId: number) => report?.partners.find((p) => p.agentId === agentId)?.cashHeld ?? null;
  const skel = <Skeleton width={90} height={28} />;

  return (
    <div className="collections vstack">
      {failed && !report ? (
        <div className="card"><EmptyState title="The collections could not load." action={<Button onClick={reload}>Try again</Button>} /></div>
      ) : (
        <>
          <div className="grid kpis" aria-busy={!report}>
            <Tile icon={<Hourglass />} tone="gold" value={s ? formatCurrency(s.totalOutstandingAmount) : skel} label="Cash with agents and 3PLs"
              footer={<><span>{s ? `${ordersText(s.totalOrders)} delivered, unpaid` : 'Delivered orders unpaid'}</span>{s && s.totalOrders > 0 && <Tag tone="warn">Chase</Tag>}</>} />
            <Tile icon={<AlarmClock />} tone="coral" value={s ? formatCurrency(lateAmount) : skel} label="Overdue, 8 days or more"
              footer={<><span>{s ? `${ordersText(lateOrders)}${latePartners.length === 1 ? `, all ${latePartners[0].name}` : ''}` : 'Oldest orders'}</span>{s && lateOrders > 0 && <Tag tone="bad">Overdue</Tag>}</>} />
            <Tile icon={<ClipboardCheck />} tone="violet" value={toVerify ? toVerify.length : <Skeleton width={50} height={28} />} label="Collections to verify"
              footer={<><span>{toVerify ? formatCurrency(toVerifyAmount) : 'Pay-ins waiting'}</span>{toVerify && toVerify.length > 0 && <Tag tone="warn">Pending</Tag>}</>} />
            <Tile icon={<Ban />} tone="pine" value={s ? s.blockedPartners : <Skeleton width={50} height={28} />} label="Blocked from deliveries"
              footer={<><span>Block stops new assignments</span>{s && s.blockedPartners === 0 && <Tag tone="n">None</Tag>}</>} />
          </div>

          {report ? <CashExposureCard report={report} /> : <div className="card"><ListSkeleton label="Loading exposure" rows={3} height={26} /></div>}

          {report ? (
            <AgentAgingTab
              report={report}
              busyId={busyId}
              onRemind={(p) => void remind(p)}
              onBlock={setBlocking}
              onUnblock={(p) => void unblock(p)}
              onExport={() => void exportCsv()}
            />
          ) : (
            <div className="card"><ListSkeleton label="Loading partners" rows={2} height={44} /></div>
          )}

          {deposits ? (
            <CollectionsToVerifyCard deposits={deposits} onReview={setReviewing} onChanged={reload} />
          ) : payIns.status === 'failed' ? (
            <div className="card"><EmptyState title="The collections to verify could not load." action={<Button onClick={payIns.retry}>Try again</Button>} /></div>
          ) : (
            <div className="card"><ListSkeleton label="Loading collections to verify" rows={2} height={44} /></div>
          )}
        </>
      )}

      {reviewing && <CollectionActionModal deposit={reviewing} cashHeld={cashHeldOf(reviewing.agentId)} onClose={() => setReviewing(null)} onChanged={reload} />}
      {blocking && <BlockPartnerModal partnerId={blocking.agentId} partnerName={blocking.name} onClose={() => setBlocking(null)} onBlocked={aging.retry} />}
    </div>
  );
}
