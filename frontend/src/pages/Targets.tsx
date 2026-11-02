import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { Button, ConfirmDialog, Skeleton, useToast } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { useV2Page } from '../components/shell/useV2Page';
import { useFinancialStore } from '../stores/financialStore';
import { targetsService, type DailyProgress, type RoleRow } from '../services/targets.service';
import { todayYmd } from '../utils/format';
import { apiMessage } from './orders/importText';
import { BlockError } from './dashboard/blocks/Frame';
import { useBlock } from './financial/profit/useBlock';
import { NorthStarCard } from './targets/NorthStarCard';
import { RoleGroups, type DailyRow } from './targets/RoleGroups';
import { TargetDialog } from './targets/TargetDialog';
import { buildGroups, METRICS, type HolderLine, type RoleGroup, type TargetForm } from './targets/model';

const DAILY_METRICS = METRICS.daily;
const NO_ROLES: RoleRow[] = [];

interface Pending { id: number; title: string; text: string; /** What to ask again after the delete. */ daily: boolean }

/**
 * The Targets page (M6-T15, F-1100 to F-1103), built from docs/mockups/v2/index.html#targets: the North Star with its quarters and
 * months, then the targets by role of the chosen month (this month at first; a month cell of the tree changes it). Each block asks on its
 * own, so a failing reward read never blanks the tree. "Edit North Star" (Owner) opens the setup wizard at step 3.
 */
export function Targets() {
  useV2Page();
  const say = useToast();
  const navigate = useNavigate();
  const setDateRange = useFinancialStore((s) => s.setDateRange);
  const { can, isSuperAdmin } = usePermissions();
  const canEdit = can('users', 'update');
  const today = todayYmd();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const year = Number(month.slice(0, 4));
  const started = month <= currentMonth;

  const tree = useBlock(`targets/tree|${month}`, () => targetsService.tree(year, month));
  // These are extras: when one fails the table still shows, with "—" where it would have written the figure
  const attainment = useBlock(`rewards/attainment|${month}`, () => targetsService.attainment(month).catch(() => null), started);
  const settings = useBlock('rewards/settings', () => targetsService.rewardSettings().catch(() => null));
  const calculators = useBlock(`targets/calculators|${month}`, () => targetsService.calculators(month).catch(() => null));
  const daily = useBlock(`targets/daily|${today}`, () =>
    Promise.all(DAILY_METRICS.map((m) => targetsService.daily(m.key, today).catch((): DailyProgress | null => null))));

  const [dialog, setDialog] = useState<{ initial: TargetForm; editing: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const data = tree.data;
  const currency = data?.currency ?? 'GHS';
  const roles = data?.roles ?? NO_ROLES;
  const groups = useMemo(
    () => buildGroups(roles, started ? attainment.data ?? null : null, settings.data ?? null, currency),
    [roles, started, attainment.data, settings.data, currency],
  );
  // Daily targets are not monthly: they show with this month only, and only the ones that are set
  const dailyRows = useMemo<DailyRow[]>(
    () => (month !== currentMonth ? [] : DAILY_METRICS.flatMap((m, i) => {
      const progress = daily.data?.[i];
      return progress && progress.target !== null ? [{ label: m.label, progress }] : [];
    })),
    [month, currentMonth, daily.data],
  );

  const blank = (patch: Partial<TargetForm> = {}): TargetForm => ({ scope: 'role', roleId: '', userId: '', metric: 'revenue', period: month, value: '', ...patch });
  /** The form for something that may already have a target: an edit when it has one, else a new one with the same fields filled in. */
  const editOf = (own: { metric: string; value: number } | null | undefined, patch: Partial<TargetForm>) => setDialog({
    editing: own != null,
    initial: blank({ ...patch, ...(own && { metric: own.metric, value: String(own.value) }) }),
  });
  const openRow = (group: RoleGroup, line: HolderLine | null) => editOf(
    line ? line.holder.target : group.role.target,
    { scope: line ? 'person' : 'role', roleId: String(group.role.roleId), userId: line ? String(line.holder.userId) : '' },
  );
  const openDaily = (metric: string) => {
    const current = daily.data?.find((d) => d?.metric === metric)?.target;
    editOf(current == null ? null : { metric, value: current }, { scope: 'daily', metric, period: today });
  };

  /** A saved or deleted target changes the tree rows and the progress of a role target or a person; a daily one only its own rows. */
  const refresh = (dailyOnly: boolean) => {
    if (dailyOnly) { daily.retry(); return; }
    tree.retry();
    attainment.retry();
  };
  const askRemove = (line: HolderLine) => setPending({
    id: line.targetId as number, title: `Delete the target of ${line.holder.name}?`, daily: false,
    text: 'Their share goes back to the role pool. Nothing else changes.',
  });
  const askRemoveDaily = (p: DailyProgress) => setPending({
    id: p.id as number, title: 'Delete this daily target?', daily: true,
    text: 'The Dashboard quest goes back to its default target.',
  });
  const remove = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    try {
      await targetsService.remove(p.id);
      say('Target deleted');
      refresh(p.daily);
    } catch (err) {
      say(await apiMessage(err, 'The target could not be deleted.'));
    }
  };
  const openFinance = () => {
    const last = new Date(Date.UTC(year, Number(month.slice(5)), 0)).getUTCDate();
    setDateRange(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`);
    navigate('/finance');
  };

  return (
    <section className="targets">
      <div className="head">
        <div>
          <h1>Targets</h1>
          <p>The North Star splits into quarters and months, with revenue and margin at each level.</p>
        </div>
        {(canEdit || isSuperAdmin) && (
          <div className="tg-head-actions">
            {isSuperAdmin && <Button onClick={() => navigate('/onboarding?step=3')}><Pencil />Edit North Star</Button>}
            {canEdit && <Button variant="primary" onClick={() => setDialog({ initial: blank(), editing: false })}><Plus />Add target</Button>}
          </div>
        )}
      </div>

      {tree.status === 'failed' && !data ? (
        <BlockError name="The targets" onRetry={tree.retry} />
      ) : !data ? (
        <Skeleton height={320} className="skelcard" />
      ) : (
        <>
          <NorthStarCard tree={data} selected={month} onSelect={setMonth} />
          <RoleGroups
            month={month} groups={groups} currency={currency} feeds={calculators.data ?? null} daily={dailyRows}
            canEdit={canEdit} actions={{ edit: openRow, remove: askRemove }} onEditDaily={openDaily} onRemoveDaily={askRemoveDaily}
            onOpenFinance={openFinance}
          />
        </>
      )}

      {dialog && (
        <TargetDialog
          open onClose={() => setDialog(null)} roles={roles} initial={dialog.initial} editing={dialog.editing}
          onSaved={(message, scope) => { say(message); refresh(scope === 'daily'); }}
        />
      )}
      <ConfirmDialog open={pending !== null} onClose={() => setPending(null)} onConfirm={remove} action="Delete" count={1} noun="target" title={pending?.title}>
        {pending?.text}
      </ConfirmDialog>
    </section>
  );
}
