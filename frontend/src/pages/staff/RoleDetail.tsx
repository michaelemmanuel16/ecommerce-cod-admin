import { useRef, useState } from 'react';
import { Bot, Building2, ChevronDown, Mail, UserPlus, Wrench } from 'lucide-react';
import { Button, Card, Skeleton, Tag } from '../../components/ui-v2';
import type { RoleAssignment, RoleCard, RoleHolder } from '../../services/roles.service';
import { initials } from '../../utils/people';
import { formatDate } from '../../utils/format';
import { FloatingMenu } from '../orders/FloatingMenu';
import { AssignBox, type AssignKind } from './AssignBox';
import { STATUS_LABEL, STATUS_TONE, TYPE_LABEL, TYPE_TONE } from './model';
import { avatarClass, targetOf, toolLabel, type RoleProgress } from './roleModel';

export type AssignChoice = 'person' | AssignKind;

interface RoleDetailProps {
  role: RoleCard;
  monthName: string;
  currency: string;
  progress: RoleProgress | undefined;
  /** The assignments of the role; undefined while they load. */
  history: RoleAssignment[] | undefined;
  can: { assign: boolean; remove: boolean; erase: boolean };
  /** The box under the name, open for an AI agent or a company. */
  assigning: AssignKind | null;
  onChoose: (choice: AssignChoice) => void;
  onCloseAssign: () => void;
  onAssigned: () => void;
  onRemove: (holder: RoleHolder) => void;
  onDelete: () => void;
}

const CHOICES: Array<{ id: AssignChoice; title: string; text: (role: RoleCard) => string; icon: typeof Mail; tone: string }> = [
  { id: 'person', title: 'Invite a person', text: () => 'Send an invite by email or phone', icon: Mail, tone: 'pine' },
  { id: 'ai_agent', title: 'Connect an AI agent', text: (r) => `It gets an MCP key limited to this role's ${r.toolCount} tools`, icon: Bot, tone: 'violet' },
  { id: 'company', title: 'Add a company', text: () => 'A 3PL or agency, with its own login or CSV', icon: Building2, tone: 'gold' },
];

/** The detail of the selected role (F-1151): the Assign menu, the monthly target, the holders, the tools summary and the history of holders who left. */
export function RoleDetail({ role, monthName, currency, progress, history, can, assigning, onChoose, onCloseAssign, onAssigned, onRemove, onDelete }: RoleDetailProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const target = targetOf(role, currency);
  const vacant = role.holders.length === 0;
  const left = (history ?? []).filter((a) => !a.current);
  const owner = role.presetRole === 'super_admin';

  return (
    <Card className="detail" aria-label={`${role.name} role`}>
      <div className="ct">
        <h3>{role.name}</h3>
        {can.assign && (
          <>
            <button ref={trigger} type="button" className="btn pri" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
              <UserPlus />Assign<ChevronDown />
            </button>
            {menu && trigger.current && (
              <FloatingMenu anchor={trigger.current} label={`Assign ${role.name}`} width={300} onClose={() => setMenu(false)}>
                <div className="rolemenu">
                  {CHOICES.map((c) => (
                    <button key={c.id} type="button" role="menuitem" onClick={() => { setMenu(false); onChoose(c.id); }}>
                      <span className={`mi ${c.tone}`}><c.icon aria-hidden="true" /></span>
                      <span><b>{c.title}</b><small>{c.text(role)}</small></span>
                    </button>
                  ))}
                </div>
              </FloatingMenu>
            )}
          </>
        )}
      </div>
      <p className="sub">{role.contract?.purpose ?? role.area ?? ''}</p>
      {assigning && <AssignBox key={`${role.id}-${assigning}`} role={role} kind={assigning} onClose={onCloseAssign} onAssigned={onAssigned} />}

      <div className="dsec">
        <h4>{monthName} target</h4>
        <div className="dbox">
          <div className="row"><b>{target ?? 'No target set'}</b>{vacant ? <Tag tone="warn">Vacant</Tag> : progress?.status && <Tag tone={progress.status.tone}>{progress.status.label}</Tag>}</div>
          {progress && <div className="prog" role="progressbar" aria-label={`${role.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><i className={progress.tone} style={{ width: `${progress.percent}%` }} /></div>}
          {progress && <small className="dsub">{progress.text}</small>}
        </div>
      </div>

      <div className="dsec">
        <h4>Holders</h4>
        {vacant ? (
          <div className="vacant"><span>Nobody holds this role.</span></div>
        ) : (
          <ul className="hlist">
            {role.holders.map((h) => (
              <li key={h.assignmentId} className="who">
                <div className={avatarClass(h.kind, h.id)} aria-hidden="true">{initials(h.name)}</div>
                <span className="nm">{h.name}</span>
                <Tag tone={TYPE_TONE[h.kind]}>{TYPE_LABEL[h.kind]}</Tag>
                {h.status !== 'active' && <Tag tone={STATUS_TONE[h.status]}>{STATUS_LABEL[h.status]}</Tag>}
                {can.remove && <Button size="mini" aria-label={`Remove ${h.name} from ${role.name}`} onClick={() => onRemove(h)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dsec">
        <h4><span>Allowed tools</span><span>{role.toolCount} of {role.toolTotal} on</span></h4>
        {/* M6-T21 puts the read and write switches and the Advanced permissions panel here. */}
        <div className="dbox" data-slot="role-tools">
          {role.tools.length === 0 ? <small>No tools are on. People in this role can sign in and see nothing.</small> : (
            <div className="toolchips">{role.tools.map((t) => <Tag key={t}>{toolLabel(t)}</Tag>)}</div>
          )}
        </div>
      </div>

      <div className="dsec">
        <h4>History</h4>
        {history === undefined ? <Skeleton height={44} /> : left.length === 0 ? (
          <small className="dsub">Nobody has left this role.</small>
        ) : (
          <ul className="hlist" aria-label="Holders who left">
            {left.map((a) => (
              <li key={a.assignmentId} className="who off">
                <div className={avatarClass(a.kind, a.id)} aria-hidden="true">{initials(a.name)}</div>
                <span className="nm">{a.name}</span>
                <Tag tone={TYPE_TONE[a.kind]}>{TYPE_LABEL[a.kind]}</Tag>
                <small>{formatDate(a.from, 'd MMM yyyy')} to {a.to ? formatDate(a.to, 'd MMM yyyy') : 'now'}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="dfootnote"><Wrench aria-hidden="true" /><span>{owner ? 'The owner always has every tool.' : 'An AI agent in this role gets an MCP key limited to the tools switched on here.'}</span></div>
      {can.erase && !owner && <div className="dsec ddel"><Button variant="danger" onClick={onDelete}>Delete role</Button></div>}
    </Card>
  );
}
