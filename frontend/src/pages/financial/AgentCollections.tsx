import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, Clock, HandCoins, Hourglass, ShieldAlert } from 'lucide-react';
import { Button, EmptyState, Skeleton, Tile, useToast } from '../../components/ui-v2';
import { AgentAgingTab } from '../../components/financial/AgentAgingTab';
import { UnpaidByAgeCard } from '../../components/financial/UnpaidByAgeCard';
import { CollectionActionModal } from '../../components/financial/modals/CollectionActionModal';
import { BlockPartnerModal } from '../../components/financial/modals/BlockPartnerModal';
import { collectionsService, unpaidByAgeOf, type AgingPartner, type AgingReport } from '../../services/collections.service';
import { financialService } from '../../services/financial.service';
import { usePermissions } from '../../hooks/usePermissions';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency } from '../../utils/format';
import { ListSkeleton } from '../deliveries/ListSkeleton';
import { ordersText } from './collections/model';

/**
 * The Agent collections tab of Finance (F-704, F-910 to F-912, M5-T36): aging by partner with the four buckets, cash held,
 * oldest unpaid and days to pay; a review modal (verify reconciles in one step, reject needs a reason); reminder; block and unblock.
 * One aging request feeds the tiles, the card and the table.
 */
export function AgentCollections() {
  const say = useToast();
  const { isAdmin } = usePermissions();
  const [report, setReport] = useState<AgingReport | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      setReport(await collectionsService.aging());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const [reviewing, setReviewing] = useState<AgingPartner | null>(null);
  const [blocking, setBlocking] = useState<AgingPartner | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const card = useMemo(() => (report ? unpaidByAgeOf(report) : null), [report]);

  /** Runs one call for a partner (its buttons wait meanwhile), says `message` when it works and the server's sentence when it does not. */
  const act = async (p: AgingPartner, run: () => Promise<string>, fallback: string) => {
    setBusyId(p.agentId);
    try {
      say(await run());
      await reload();
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

  const checkCash = async () => {
    try {
      await collectionsService.syncCashFindings();
      say('Cash held checked');
      await reload();
    } catch (e) {
      say(apiErrorMessage(e, 'The check did not run.'));
    }
  };

  const exportCsv = async () => {
    try {
      await financialService.downloadAgentAgingCSV();
      say('Agent aging exported');
    } catch {
      say('The report could not be exported.');
    }
  };

  const s = report?.summary;
  return (
    <div className="collections">
      <div className="agtools top">
        <Link className="btn" to="/finance/findings"><ShieldAlert />Findings</Link>
        {isAdmin && <Button onClick={() => void checkCash()}>Check cash held</Button>}
      </div>

      {failed && !report ? (
        <div className="card"><EmptyState title="The collections could not load." action={<Button onClick={() => void reload()}>Try again</Button>} /></div>
      ) : (
        <>
          <div className="grid kpis k5" style={{ marginTop: 0 }} aria-busy={!report}>
            <Tile icon={<HandCoins />} tone="pine" value={s ? s.partnersWithCash : <Skeleton width={50} height={28} />} label="Partners holding cash" footer={<span>Cash held above zero</span>} />
            <Tile icon={<AlertTriangle />} tone="coral" value={s ? s.overduePartners : <Skeleton width={50} height={28} />} label="Overdue partners" footer={<span>Past days to pay</span>} />
            <Tile icon={<Hourglass />} tone="gold" value={s ? formatCurrency(s.totalOutstandingAmount) : <Skeleton width={90} height={28} />} label="Unpaid delivered orders" footer={<span>{s ? `${ordersText(s.totalOrders)}, net of delivery fee` : 'Net of delivery fee'}</span>} />
            <Tile icon={<Clock />} tone="coral" value={s ? formatCurrency(s.overdueAmount) : <Skeleton width={90} height={28} />} label="Overdue" footer={<span>{s ? `${ordersText(s.overdueOrders)} past days to pay` : 'Past days to pay'}</span>} />
            <Tile icon={<Ban />} tone="violet" value={s ? s.blockedPartners : <Skeleton width={50} height={28} />} label="Blocked partners" footer={<span>Keep their open deliveries</span>} />
          </div>

          <UnpaidByAgeCard data={card} />

          {report ? (
            <AgentAgingTab
              report={report}
              busyId={busyId}
              onReview={setReviewing}
              onRemind={(p) => void remind(p)}
              onBlock={setBlocking}
              onUnblock={(p) => void unblock(p)}
              onExport={() => void exportCsv()}
            />
          ) : (
            <div className="card"><ListSkeleton label="Loading partners" rows={2} height={44} style={{ padding: 20 }} /></div>
          )}
        </>
      )}

      {reviewing && <CollectionActionModal agentId={reviewing.agentId} agentName={reviewing.name} onClose={() => setReviewing(null)} onChanged={reload} />}
      {blocking && <BlockPartnerModal partnerId={blocking.agentId} partnerName={blocking.name} onClose={() => setBlocking(null)} onBlocked={reload} />}
    </div>
  );
}
