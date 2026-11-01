import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Users } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, Select, Skeleton, Tabs, useToast } from '../components/ui-v2';
import { useV2Page } from '../components/shell/useV2Page';
import { usePermissions } from '../hooks/usePermissions';
import { useAuthStore } from '../stores/authStore';
import { rolesService, toStaffRoles } from '../services/roles.service';
import { companyRepPay, staffService, type InviteResult, type StaffRow } from '../services/staff.service';
import { SEARCH_DEBOUNCE_MS } from '../utils/urlState';
import { apiMessage } from './orders/importText';
import { BlockError } from './dashboard/blocks/Frame';
import { useBlock } from './financial/profit/useBlock';
import { DeactivateDialog } from './staff/DeactivateDialog';
import { InviteLinkDialog } from './staff/InviteLinkDialog';
import { PermanentDeleteModal } from './staff/PermanentDeleteModal';
import { PersonModal } from './staff/PersonModal';
import { ResetPasswordModal } from './staff/ResetPasswordModal';
import { RoleCards } from './staff/RoleCards';
import type { RowAction } from './staff/RowMenu';
import { TeamTable } from './staff/TeamTable';
import { headerText, parseView, tabCount, TABS, writeView, type StaffView, type TabId } from './staff/model';
import { reassignOpenOrders } from './staff/reassign';

type Confirm = { kind: 'delete' | 'deactivate' | 'revoke'; row: StaffRow };
type Deactivating = { row: StaffRow; openOrders: number; takers: StaffRow[] };

const CONFIRM_TEXT: Record<Confirm['kind'], { action: string; noun: string; text: (name: string) => string }> = {
  delete: { action: 'Delete', noun: 'person', text: (n) => `${n} will be removed from the team and cannot sign in. Their orders and history stay. You can restore them from the Deleted tab.` },
  deactivate: { action: 'Deactivate', noun: 'person', text: (n) => `${n} is signed out at once and cannot sign in until you reactivate them.` },
  revoke: { action: 'Revoke', noun: 'invite', text: (n) => `The link sent to ${n} stops working. They move to the Deleted tab.` },
};

/**
 * The Staff page (M6-T20, F-1157 to F-1161, F-1165), built from docs/mockups/v2/staff.html: the team table with tabs, filters,
 * the invite and edit modals and the row actions. The role cards of M6-T19 (F-1151, F-1152, F-1156) sit above the table. The tab, the role,
 * the search and the open invite modal are in the URL; the North Star wizard links to `?invite=1`.
 */
export function Staff() {
  useV2Page();
  const say = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = parseView(params);
  const { can } = usePermissions();
  const isOwner = useAuthStore((s) => s.user?.role === 'super_admin');
  const allowed = { update: can('users', 'update'), delete: can('users', 'delete'), erase: isOwner };

  const [search, setSearch] = useState(view.q);
  const patch = (next: Partial<StaffView>) => setParams(writeView({ ...view, ...next }), { replace: true });
  // The search waits for a pause in typing before it asks again
  const latest = useRef({ view, patch });
  latest.current = { view, patch };
  useEffect(() => {
    if (search === latest.current.view.q) return undefined;
    const t = setTimeout(() => latest.current.patch({ q: search }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const list = useBlock(`staff|${view.tab}|${view.role}|${view.q}`, () =>
    staffService.list({ ...(view.tab !== 'all' && { status: view.tab }), ...(view.role && { role: view.role }), ...(view.q && { q: view.q }) }));
  const overview = useBlock('staff|roles', () => rolesService.overview());
  const roles = useMemo(() => (overview.data ? toStaffRoles(overview.data) : []), [overview.data]);
  const pay = useBlock('staff|pay', () => companyRepPay());

  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [resetting, setResetting] = useState<StaffRow | null>(null);
  const [erasing, setErasing] = useState<StaffRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [deactivating, setDeactivating] = useState<Deactivating | null>(null);
  const [unsent, setUnsent] = useState<{ name: string; reason?: string; link: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // The role an invite starts on, when it was opened from a role card
  const [inviteRole, setInviteRole] = useState<number | undefined>();

  const currency = pay.data?.currency ?? 'GHS';
  const company = pay.data ?? null;
  const rows = list.data?.staff ?? [];
  const counts = list.data?.counts;
  const filtered = view.role !== '' || view.q !== '';

  /** Runs one change, says `done` once, and reads the table again. A refusal of the API shows once as a toast. */
  const attempt = async (change: () => Promise<unknown>, done: string | null, failed: string): Promise<boolean> => {
    setBusy(true);
    try {
      await change();
      if (done) say(done);
      list.retry();
      return true;
    } catch (err) {
      say(await apiMessage(err, failed));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** An invite or a resend went through: a toast when it was sent, the link to copy when it was not. */
  const reportInvite = (r: InviteResult) => {
    if (r.delivery.sent) say(`Invite sent to ${r.staff.name}`);
    else setUnsent({ name: r.staff.name, reason: r.delivery.reason, link: r.link });
  };

  const startDeactivate = async (row: StaffRow) => {
    try {
      const [workload, same] = await Promise.all([staffService.workload(), staffService.list({ status: 'active', role: row.role })]);
      const openOrders = workload.find((w) => w.id === row.id)?.openOrders ?? 0;
      if (openOrders === 0) { setConfirm({ kind: 'deactivate', row }); return; }
      setDeactivating({ row, openOrders, takers: same.staff.filter((s) => s.id !== row.id && s.kind === 'person') });
    } catch (err) {
      say(await apiMessage(err, 'The open orders could not be read.'));
    }
  };

  const onAction = (action: RowAction, row: StaffRow) => {
    switch (action) {
      case 'edit': setEditing(row); break;
      case 'payout': navigate(row.feeRule ? `/deliveries?partner=${row.id}` : '/finance?financial-tab=rep-commissions'); break;
      case 'key': navigate('/connections'); break;
      case 'reset': setResetting(row); break;
      case 'resend': void attempt(async () => reportInvite(await staffService.resend(row.id, 'email')), null, 'The invite could not be sent.'); break;
      case 'revoke': setConfirm({ kind: 'revoke', row }); break;
      case 'deactivate': void startDeactivate(row); break;
      case 'reactivate': case 'restore': void attempt(() => staffService.reactivate(row.id), `${row.name} is back`, 'The person could not be reactivated.'); break;
      case 'delete': setConfirm({ kind: 'delete', row }); break;
      case 'erase': setErasing(row); break;
    }
  };

  const runConfirm = async () => {
    const c = confirm;
    setConfirm(null);
    if (!c) return;
    if (c.kind === 'delete') await attempt(() => staffService.remove(c.row.id), `${c.row.name} was deleted`, 'The person could not be deleted.');
    else if (c.kind === 'deactivate') await attempt(() => staffService.deactivate(c.row.id), `${c.row.name} is deactivated`, 'The person could not be deactivated.');
    else await attempt(() => staffService.revoke(c.row.id), `Invite to ${c.row.name} revoked`, 'The invite could not be revoked.');
  };

  const runDeactivate = async (takerId: number | null) => {
    const d = deactivating;
    if (!d) return;
    const done = await attempt(async () => {
      const moved = takerId === null ? 0 : await reassignOpenOrders(d.row, takerId);
      await staffService.deactivate(d.row.id);
      return moved;
    }, `${d.row.name} is deactivated`, 'The person could not be deactivated.');
    if (done) setDeactivating(null);
  };

  const tabs = useMemo(() => TABS.filter((t) => t.id !== 'deleted' || (counts?.deleted ?? 0) > 0 || view.tab === 'deleted')
    .map((t) => ({ id: t.id, label: t.label, ...(counts && { count: tabCount(counts, t.id) }) })), [counts, view.tab]);

  return (
    <section className="staff">
      <div className="head">
        <div>
          <h1>Staff &amp; roles</h1>
          <p>People, AI agents and companies on your team. Invite a person and they choose their own password.</p>
        </div>
        {can('users', 'create') && (
          <div className="staff-head-actions">
            <Button variant="primary" onClick={() => patch({ invite: true })}><Plus />Invite a person</Button>
          </div>
        )}
      </div>

      <RoleCards
        roles={overview.data} failed={overview.status === 'failed'} currency={currency} onRetry={overview.retry}
        can={{ create: can('users', 'create'), update: allowed.update, owner: isOwner }}
        onInvite={(roleId) => { setInviteRole(roleId); patch({ invite: true }); }}
        onChanged={() => { overview.retry(); list.retry(); }}
      />

      <Card title="People, agents and companies" aside={counts ? headerText(counts) : undefined}>
        <Tabs items={tabs} value={view.tab} label="Team status" onChange={(id) => patch({ tab: id as TabId })} />
        <div className="staff-filters">
          <label className="staff-search">
            <Search aria-hidden="true" />
            <input type="search" aria-label="Search the team" placeholder="Search name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <Select compact label="Filter by role" value={view.role} onChange={(e) => patch({ role: e.target.value })}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.roleId} value={r.roleId}>{r.name}</option>)}
          </Select>
        </div>
        {list.status === 'failed' && !list.data ? (
          <BlockError name="The team" onRetry={list.retry} bare />
        ) : !list.data ? (
          <Skeleton height={280} className="skelcard" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={filtered ? 'No one matches' : view.tab === 'all' ? 'Nobody on the team yet' : `Nobody is ${view.tab} right now`}
            text={filtered ? 'Change the search or the role to see more.' : view.tab === 'all' ? 'Invite your first person to get started.' : undefined}
          />
        ) : (
          <TeamTable rows={rows} company={company} currency={currency} can={allowed} onAction={onAction} />
        )}
      </Card>

      {view.invite && (
        <PersonModal
          roles={roles} roleId={inviteRole} company={company} currency={currency} onClose={() => { setInviteRole(undefined); patch({ invite: false }); }}
          onInvited={(r) => { setInviteRole(undefined); patch({ invite: false }); reportInvite(r); overview.retry(); list.retry(); }} onSaved={() => undefined}
        />
      )}
      {editing && (
        <PersonModal
          row={editing} roles={roles} company={company} currency={currency} onClose={() => setEditing(null)}
          onInvited={() => undefined} onSaved={(r) => { setEditing(null); say(`${r.name} saved`); list.retry(); }}
        />
      )}
      {resetting && <ResetPasswordModal row={resetting} onClose={() => setResetting(null)} />}
      {erasing && (
        <PermanentDeleteModal
          row={erasing} busy={busy} onClose={() => setErasing(null)}
          onConfirm={(typed) => void attempt(() => staffService.removePermanently(erasing.id, typed), `${erasing.name} was deleted for good`, 'The person could not be deleted.').then((ok) => ok && setErasing(null))}
        />
      )}
      {deactivating && (
        <DeactivateDialog {...deactivating} busy={busy} onClose={() => setDeactivating(null)} onConfirm={(id) => void runDeactivate(id)} />
      )}
      {unsent && <InviteLinkDialog {...unsent} onClose={() => setUnsent(null)} />}
      {/* The one confirm dialog of every delete, deactivate and revoke, with its count */}
      <ConfirmDialog
        open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => void runConfirm()}
        action={confirm ? CONFIRM_TEXT[confirm.kind].action : 'Delete'} count={1} noun={confirm ? CONFIRM_TEXT[confirm.kind].noun : 'person'}
      >
        {confirm ? CONFIRM_TEXT[confirm.kind].text(confirm.row.name) : null}
      </ConfirmDialog>
    </section>
  );
}
