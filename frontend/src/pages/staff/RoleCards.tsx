import { useMemo, useState } from 'react';
import { Boxes, Briefcase, Crown, Megaphone, PhoneCall, Plus, Truck, Wallet, Wrench, UserX } from 'lucide-react';
import { Button, ConfirmDialog, Tag, useToast } from '../../components/ui-v2';
import { rolesService, type RoleCard, type RoleHolder } from '../../services/roles.service';
import { targetsService } from '../../services/targets.service';
import { todayYmd } from '../../utils/format';
import { initials } from '../../utils/people';
import { apiMessage } from '../orders/importText';
import { BlockError } from '../dashboard/blocks/Frame';
import { useBlock } from '../financial/profit/useBlock';
import { monthName } from '../targets/model';
import type { AssignKind } from './AssignBox';
import { NewRoleModal } from './NewRoleModal';
import { RoleDetail, type AssignChoice } from './RoleDetail';
import { TYPE_LABEL, TYPE_TONE } from './model';
import { avatarClass, roleProgress, targetOf, type RoleProgress } from './roleModel';

interface RoleCardsProps {
  /** The role overview (users:view); undefined while it loads. */
  roles: RoleCard[] | undefined;
  failed: boolean;
  currency: string;
  can: { create: boolean; update: boolean; owner: boolean };
  /** "Invite a person" with the role chosen: the invite modal of the team table. */
  onInvite: (roleId: number) => void;
  /** The roles or their holders changed: the overview and the team table ask again. */
  onChanged: () => void;
  onRetry: () => void;
}

function iconOf(role: RoleCard) {
  if (role.presetRole === 'super_admin') return Crown;
  if (role.presetRole === 'sales_rep') return PhoneCall;
  if (role.presetRole === 'delivery_agent') return Truck;
  if (role.presetRole === 'accountant') return Wallet;
  if (role.presetRole === 'inventory_manager') return Boxes;
  return role.name === 'Marketing' ? Megaphone : Briefcase;
}

/** One card: the role, its holders with type tags, the target of the month with its progress, and "n of 16 tools allowed". */
function RoleCardView({ role, currency, month, progress, selected, onSelect }: { role: RoleCard; currency: string; month: string; progress: RoleProgress | undefined; selected: boolean; onSelect: () => void }) {
  const Icon = iconOf(role);
  const vacant = role.holders.length === 0;
  const target = targetOf(role, currency);
  return (
    <div
      className={`card rolecard${selected ? ' on' : ''}`} role="button" tabIndex={0} aria-pressed={selected} aria-label={`${role.name} role`}
      onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      <div className="rc-top">
        <div className="rc-ic"><Icon aria-hidden="true" /></div>
        <div><b>{role.name}</b><small>{vacant ? 'No holder' : `${role.holders.length} ${role.holders.length === 1 ? 'holder' : 'holders'}`}</small></div>
        {vacant ? <Tag tone="warn">Vacant</Tag> : progress?.status && <Tag tone={progress.status.tone}>{progress.status.label}</Tag>}
      </div>
      {vacant ? (
        <div className="vacant"><UserX aria-hidden="true" /><span>Nobody holds this role.</span></div>
      ) : (
        <div className="holders">
          {role.holders.map((h) => (
            <div className="who" key={h.assignmentId}>
              <div className={avatarClass(h.kind, h.id)} aria-hidden="true">{initials(h.name)}</div>
              <span className="nm">{h.name}</span>
              <Tag tone={TYPE_TONE[h.kind]}>{TYPE_LABEL[h.kind]}</Tag>
            </div>
          ))}
        </div>
      )}
      <div className="rc-tgt">
        <small>{monthName(month)} target</small>
        <b>{target ?? 'No target set'}</b>
        {progress && !vacant && <div className="prog" role="progressbar" aria-label={`${role.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i className={progress.tone} style={{ width: `${progress.percent}%` }} /></div>}
        {progress && !vacant && <small className="dsub">{progress.text}</small>}
      </div>
      <div className="rc-foot"><Wrench aria-hidden="true" /><span>{role.toolCount} of {role.toolTotal} tools allowed</span></div>
    </div>
  );
}

/**
 * The role cards above the team table (M6-T19, F-1151, F-1152, F-1156), built from the role section of docs/mockups/v2/staff.html:
 * a card per role, the detail of the selected one, the Assign menu, New role and Delete role. The numbers come from the API.
 * Progress is read from the targets of this month; a person who may not read targets sees the cards without it.
 */
export function RoleCards({ roles, failed, currency, can, onInvite, onChanged, onRetry }: RoleCardsProps) {
  const say = useToast();
  const month = todayYmd().slice(0, 7);
  const tree = useBlock(`staff|tree|${month}`, () => targetsService.tree(Number(month.slice(0, 4)), month).catch(() => null));
  const attainment = useBlock(`staff|attainment|${month}`, () => targetsService.attainment(month).catch(() => null));
  const progress = useMemo(() => roleProgress(tree.data ?? null, attainment.data ?? null, currency), [tree.data, attainment.data, currency]);

  const [chosen, setChosen] = useState<number | null>(null);
  const [assigning, setAssigning] = useState<AssignKind | null>(null);
  const [making, setMaking] = useState(false);
  const [removing, setRemoving] = useState<RoleHolder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const role = roles?.find((r) => r.id === chosen) ?? roles?.[0];
  const history = useBlock(`staff|assignments|${role?.id}`, () => rolesService.assignments(role!.id), role !== undefined);

  const changed = () => { onChanged(); history.retry(); };
  const select = (id: number) => { setChosen(id); setAssigning(null); };
  const choose = (choice: AssignChoice) => (choice === 'person' ? onInvite(role!.id) : setAssigning(choice));

  const remove = async () => {
    const holder = removing;
    setRemoving(null);
    if (!holder || !role) return;
    try {
      await rolesService.unassign(role.id, holder.assignmentId);
      say(`${holder.name} left ${role.name}`);
      changed();
    } catch (err) {
      say(await apiMessage(err, `${holder.name} could not be removed.`));
    }
  };

  const erase = async () => {
    setDeleting(false);
    if (!role) return;
    try {
      await rolesService.remove(role.id);
      say(`${role.name} was deleted`);
      setChosen(null);
      changed();
    } catch (err) {
      say(await apiMessage(err, 'The role could not be deleted.'));
    }
  };

  return (
    <div className="staff-roles">
      <div className="sechead">
        <h2>Roles</h2>
        <div className="sechead-tools">
          <div className="legend" aria-label="Holder types">
            {(['person', 'ai_agent', 'company'] as const).map((k) => <Tag key={k} tone={TYPE_TONE[k]}>{TYPE_LABEL[k]}</Tag>)}
          </div>
          {can.owner && <Button size="mini" onClick={() => setMaking(true)}><Plus />New role</Button>}
        </div>
      </div>
      {failed && !roles ? (
        <BlockError name="The roles" onRetry={onRetry} />
      ) : !roles ? (
        <div className="staff-roles-skel" aria-busy="true" />
      ) : (
        <div className="mdl">
          <div className="roles">
            {roles.map((r) => (
              <RoleCardView key={r.id} role={r} currency={currency} month={month} progress={progress.get(r.id)} selected={r.id === role?.id} onSelect={() => select(r.id)} />
            ))}
          </div>
          {role && (
            <RoleDetail
              role={role} monthName={monthName(month)} currency={currency} progress={progress.get(role.id)} history={history.data}
              can={{ assign: can.create, remove: can.update, erase: can.owner }} assigning={assigning}
              onChoose={choose} onCloseAssign={() => setAssigning(null)} onAssigned={changed}
              onRemove={setRemoving} onDelete={() => setDeleting(true)}
            />
          )}
        </div>
      )}
      {making && roles && (
        <NewRoleModal roles={roles} onClose={() => setMaking(false)} onCreated={(r) => { setMaking(false); setChosen(r.id); say(`${r.name} was created`); changed(); }} />
      )}
      <ConfirmDialog open={removing !== null} onClose={() => setRemoving(null)} onConfirm={() => void remove()} action="Remove" count={1} noun="holder" title={removing && role ? `Remove ${removing.name} from ${role.name}?` : undefined}>
        {removing && role ? `${removing.name} leaves ${role.name} and moves to its history.${removing.kind === 'ai_agent' ? ' Its MCP key for this role stops working.' : ''}` : null}
      </ConfirmDialog>
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={() => void erase()} action="Delete" count={1} noun="role" title={role ? `Delete ${role.name}?` : undefined}>
        {role ? `${role.name} is removed from your team. A role with holders cannot be deleted.` : null}
      </ConfirmDialog>
    </div>
  );
}
