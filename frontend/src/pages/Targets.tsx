import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, ConfirmDialog, Skeleton, useToast } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { targetsService, type DailyProgress } from '../services/targets.service';
import { todayYmd } from '../utils/format';
import { apiMessage } from './orders/importText';
import { BlockError } from './dashboard/blocks/Frame';
import { refreshBlocks, useBlock } from './financial/profit/useBlock';
import { NorthStarCard } from './targets/NorthStarCard';
import { RoleGroups } from './targets/RoleGroups';
import { TargetDialog } from './targets/TargetDialog';
import { buildGroups, METRICS, type HolderLine, type RoleGroup, type TargetForm } from './targets/model';

/** The daily activity targets the page lists (F-1103). The key is the metric the API stores. */
const DAILY_METRICS = METRICS.daily;

interface Pending { id: number; title: string; text: string }

/**
 * The Targets page (M6-T15, F-1100 to F-1103), built from docs/mockups/v2/index.html#targets: the North Star with its quarters and
 * months, then this month's targets by role. Each block asks on its own, so a failing reward read never blanks the tree.
 * "Edit North Star" is not here: the setup wizard that owns it is M6-T17.
 */
export function Targets() {
  useV2Page();
  const say = useToast();
  const { can } = usePermissions();
  const canEdit = can('users', 'update');
  const today = todayYmd();
  const year = Number(today.slice(0, 4));
  const month = today.slice(0, 7);

  const tree = useBlock(`targets|tree|${month}`, () => targetsService.tree(year, month));
  // These three are extras: when one fails the table still shows, with "—" where it would have written the figure
  const attainment = useBlock(`targets|attainment|${month}`, () => targetsService.attainment(month).catch(() => null));
  const settings = useBlock('targets|rewards', () => targetsService.rewardSettings().catch(() => null));
  const calculators = useBlock(`targets|calculators|${month}`, () => targetsService.calculators(month).catch(() => null));
  const daily = useBlock(`targets|daily|${today}`, () =>
    Promise.all(DAILY_METRICS.map((m) => targetsService.daily(m.key, today).catch((): DailyProgress | null => null))));

  const [dialog, setDialog] = useState<{ initial: TargetForm; editing: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const data = tree.data;
  const currency = data?.currency ?? 'GHS';
  const roles = data?.roles ?? [];
  const monthNode = data?.months.find((m) => m.periodStart.startsWith(month));
  const groups = useMemo(
    () => buildGroups(roles, attainment.data ?? null, settings.data ?? null, monthNode?.actuals?.pace ?? null, currency),
    [roles, attainment.data, settings.data, monthNode, currency],
  );

  const blank = (patch: Partial<TargetForm> = {}): TargetForm => ({ scope: 'role', roleId: '', userId: '', metric: 'revenue', period: month, value: '', ...patch });
  const openAdd = () => setDialog({ initial: blank(), editing: false });
  const openRow = (group: RoleGroup, line: HolderLine | null) => {
    const own = line ? line.holder.target : group.role.target;
    setDialog({
      editing: own !== null && own !== undefined,
      initial: blank({
        scope: line ? 'person' : 'role', roleId: String(group.role.roleId), userId: line ? String(line.holder.userId) : '',
        metric: own?.metric ?? 'revenue', value: own ? String(own.value) : '',
      }),
    });
  };
  const openDaily = (metric: string) => {
    const current = daily.data?.find((d) => d?.metric === metric)?.target;
    setDialog({ editing: current != null, initial: blank({ scope: 'daily', metric, period: today, value: current != null ? String(current) : '' }) });
  };

  const askRemove = (line: HolderLine) => setPending({
    id: line.targetId!, title: `Delete the target of ${line.holder.name}?`,
    text: 'Their share goes back to the role pool. Nothing else changes.',
  });
  const askRemoveDaily = (p: DailyProgress) => setPending({
    id: p.id!, title: 'Delete this daily target?',
    text: 'The Dashboard quest goes back to its default target.',
  });
  const remove = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    try {
      await targetsService.remove(p.id);
      say('Target deleted');
      refreshBlocks();
    } catch (err) {
      say(await apiMessage(err, 'The target could not be deleted.'));
    }
  };

  return (
    <section className="targets">
      <div className="head">
        <div>
          <h1>Targets</h1>
          <p>The North Star splits into quarters and months, with revenue and margin at each level.</p>
        </div>
        {canEdit && (
          <div className="tg-head-actions">
            <Button variant="primary" onClick={openAdd}><Plus />Add target</Button>
          </div>
        )}
      </div>

      {tree.status === 'failed' && !data ? (
        <BlockError name="The targets" onRetry={tree.retry} />
      ) : !data ? (
        <Skeleton height={320} className="skelcard" />
      ) : (
        <>
          <NorthStarCard tree={data} />
          <RoleGroups
            month={month} groups={groups} currency={currency} feeds={calculators.data ?? null}
            daily={DAILY_METRICS.map((m, i) => ({ label: m.label, progress: daily.data?.[i] ?? null }))}
            canEdit={canEdit} actions={{ edit: openRow, remove: askRemove }} onEditDaily={openDaily} onRemoveDaily={askRemoveDaily}
          />
        </>
      )}

      {dialog && (
        <TargetDialog
          open onClose={() => setDialog(null)} roles={roles} initial={dialog.initial} editing={dialog.editing}
          onSaved={(message) => { say(message); refreshBlocks(); }}
        />
      )}
      <ConfirmDialog open={pending !== null} onClose={() => setPending(null)} onConfirm={remove} action="Delete" count={1} noun="target" title={pending?.title}>
        {pending?.text}
      </ConfirmDialog>
    </section>
  );
}
