import { Building2, Check, Phone, Trash2, Truck, UserMinus } from 'lucide-react';
import type { Option } from './useFilterOptions';

interface PersonProps {
  options: Option[];
  currentId?: number | null;
  onPick: (option: Option) => void;
  /** The delivery agent cannot change (the order is closed). */
  locked?: boolean;
}

const isCompany = (name: string): boolean => /express|logistics|logiswift|ltd|limited|courier|delivery/i.test(name);

/** The call rep list of the assign menus (F-314). */
export function RepItems({ options, currentId, onPick }: PersonProps) {
  return (
    <>
      {options.length === 0 && <p className="note">No call reps yet.</p>}
      {options.map((o) => (
        <button key={o.id} type="button" role="menuitem" onClick={() => onPick(o)}>
          <Phone aria-hidden="true" />
          {o.name}
          {currentId === o.id && <Check className="cur" aria-label="Current" />}
        </button>
      ))}
    </>
  );
}

/** The delivery agent list: a person marked unavailable shows "Not available today" and cannot be picked (F-314). */
export function AgentItems({ options, currentId, onPick, locked }: PersonProps) {
  return (
    <>
      {options.length === 0 && <p className="note">No delivery agents yet.</p>}
      {locked && <p className="note">This order is closed. Its delivery agent cannot change.</p>}
      {options.map((o) => (
        <button key={o.id} type="button" role="menuitem" disabled={locked || o.unavailable} onClick={() => onPick(o)}>
          {isCompany(o.name) ? <Building2 aria-hidden="true" /> : <Truck aria-hidden="true" />}
          {o.name}
          {o.unavailable && <small>Not available today</small>}
          {currentId === o.id && <Check className="cur" aria-label="Current" />}
        </button>
      ))}
    </>
  );
}

interface RowAssignProps {
  reps: Option[];
  agents: Option[];
  currentRepId?: number | null;
  currentAgentId?: number | null;
  agentLocked: boolean;
  onRep: (o: Option) => void;
  onAgent: (o: Option) => void;
  onUnassign: () => void;
  /** Absent: the person may not delete, so the item is left out. */
  onDelete?: () => void;
}

/** The menu behind a row's Assign icon: call reps, delivery agents, "Unassign both" (and "Delete order" when allowed). */
export function RowAssignItems({ reps, agents, currentRepId, currentAgentId, agentLocked, onRep, onAgent, onUnassign, onDelete }: RowAssignProps) {
  return (
    <>
      <p>Call rep</p>
      <RepItems options={reps} currentId={currentRepId} onPick={onRep} />
      <hr />
      <p>Delivery agent</p>
      <AgentItems options={agents} currentId={currentAgentId} onPick={onAgent} locked={agentLocked} />
      <hr />
      <button type="button" role="menuitem" onClick={onUnassign}>
        <UserMinus aria-hidden="true" />
        Unassign both
      </button>
      {onDelete && (
        <button type="button" role="menuitem" onClick={onDelete} style={{ color: 'var(--coral)' }}>
          <Trash2 aria-hidden="true" style={{ color: 'var(--coral)' }} />
          Delete order
        </button>
      )}
    </>
  );
}
