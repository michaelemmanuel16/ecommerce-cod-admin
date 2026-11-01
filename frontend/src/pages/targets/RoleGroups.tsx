import { Fragment, useState } from 'react';
import { ChevronDown, PhoneCall, TrendingUp } from 'lucide-react';
import { Button, Card, EmptyState, Tag } from '../../components/ui-v2';
import type { Calculators, DailyProgress } from '../../services/targets.service';
import { compactMoney } from '../dashboard/format';
import { NO_DATA, NO_PAYOUT, SET_A_TARGET, VACANT, monthName, type HolderLine, type RoleGroup } from './model';

export interface RowAction {
  /** Open the form for this line (a holder, or a whole role when `userId` is absent). */
  edit: (group: RoleGroup, line: HolderLine | null) => void;
  remove: (line: HolderLine) => void;
}

interface Props {
  month: string;
  groups: RoleGroup[];
  currency: string;
  /** "Feeds October GH₵180k: ..." from the calculators; null while they load or when they cannot answer. */
  feeds: Calculators | null;
  daily: Array<{ label: string; progress: DailyProgress | null }>;
  /** Show Edit and Delete (the person may set targets). */
  canEdit: boolean;
  actions: RowAction;
  onEditDaily: (metric: string) => void;
  onRemoveDaily: (progress: DailyProgress) => void;
}

const avatarClass = (kind: string) => (kind === 'ai_agent' ? 'a ai' : kind === 'company' ? 'a co' : 'a');

/** "October targets by role" (F-1102): a group per role, holders with target, progress, status and the reward at 100%. */
export function RoleGroups({ month, groups, currency, feeds, daily, canEdit, actions, onEditDaily, onRemoveDaily }: Props) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const dailyRows = daily.filter((d) => d.progress?.target != null);

  return (
    <Card title={`${monthName(month)} targets by role`} aside="A role can be held by a person, an AI agent or a company. Rewards are set in the Rewards setting.">
      {feeds && (
        <div className="tg-feeds">
          <TrendingUp aria-hidden />
          <span>
            Feeds {monthName(month)} {compactMoney(feeds.revenueTarget, currency)}: {new Intl.NumberFormat('en-GB').format(feeds.ordersDelivered)} delivered orders × {compactMoney(feeds.plannedAov, currency)} planned order value;
            {' '}{new Intl.NumberFormat('en-GB').format(feeds.ordersToTakeIn)} orders to take in, {feeds.ordersPerDay} a day.
          </span>
        </div>
      )}
      {groups.length === 0 ? (
        <EmptyState title="No role targets yet" text="A role target shows here once it is set. Use Add target." />
      ) : (
        <div className="tablewrap tg-scroll">
          <table className="tg-table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>Who</th><th>Their target</th><th style={{ width: '30%' }}>Progress</th><th>Status</th><th className="r">Reward at 100%</th>{canEdit && <th><span className="sr-only">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const hidden = closed.has(g.role.roleId);
                return (
                  <Fragment key={g.role.roleId}>
                    <tr className="tg-grp">
                      <td colSpan={canEdit ? 6 : 5}>
                        <div className="tg-gwrap">
                          <div>
                            <button type="button" className="tg-gt" aria-expanded={!hidden} aria-label={`Show or hide ${g.role.roleName}`} onClick={() => toggle(g.role.roleId)}><ChevronDown /></button>
                            <b>{g.role.roleName}</b> <Tag>{g.vacant ? VACANT : g.holderCount}</Tag>
                            {g.roleTargetText && <small>{g.roleTargetText}</small>}
                            {!g.roleTargetText && <small>{SET_A_TARGET} for this role</small>}
                          </div>
                          <div>
                            {g.bar && (
                              <>
                                <div className="prog" style={{ marginTop: 0 }}><i style={{ width: `${Math.min(g.bar.percent, 100)}%` }} /></div>
                                <small>{g.bar.text}</small>
                              </>
                            )}
                            {canEdit && (
                              <Button size="mini" onClick={() => actions.edit(g, null)}>{g.role.target ? 'Edit role target' : 'Set role target'}</Button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {!hidden && g.vacant && (
                      <tr><td colSpan={canEdit ? 6 : 5} className="tg-vacant">{VACANT}</td></tr>
                    )}
                    {!hidden && g.lines.map((l) => (
                      <tr key={l.holder.userId}>
                        <td>
                          <div className="tg-who">
                            <div className={avatarClass(l.holder.kind)}>{l.initials}</div>
                            <div>
                              {l.holder.name} {l.holder.kind === 'ai_agent' && <Tag tone="v">AI agent</Tag>}
                              <small>{g.role.roleName}</small>
                            </div>
                          </div>
                        </td>
                        <td>{l.targetText ?? <span className="tg-nodata">{SET_A_TARGET}</span>}</td>
                        <td>
                          {l.bar !== null && <div className="prog" style={{ marginTop: 0 }}><i className={l.bar < 50 ? 'coral' : l.bar < 100 ? 'gold' : ''} style={{ width: `${l.bar}%` }} /></div>}
                          <small className={l.detail === NO_DATA || l.detail === SET_A_TARGET ? 'tg-nodata' : ''} style={{ color: 'var(--ink-3)' }}>{l.detail}</small>
                        </td>
                        <td>{l.status ? <Tag tone={l.status.tone}>{l.status.label}</Tag> : <span className="tg-nodata">—</span>}</td>
                        <td className="r"><span className={`tg-reward${l.reward === NO_PAYOUT || l.reward === '—' ? ' none' : ''}`}>{l.reward}</span></td>
                        {canEdit && (
                          <td>
                            <div className="tg-rowtools">
                              <Button size="mini" onClick={() => actions.edit(g, l)}>{l.targetId ? 'Edit' : 'Set'}</Button>
                              {l.targetId && <Button size="mini" aria-label={`Delete the target of ${l.holder.name}`} onClick={() => actions.remove(l)}>Delete</Button>}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              {dailyRows.map(({ label, progress }) => (
                <tr key={progress!.metric}>
                  <td colSpan={canEdit ? 6 : 5}>
                    <div className="tg-who">
                      <div className="a"><PhoneCall style={{ width: 15, height: 15 }} aria-hidden /></div>
                      <div>
                        Daily target: {label}
                        <small>
                          {progress!.target} a day.{progress!.message ? ` ${progress!.message}.` : ` ${progress!.actual ?? 0} so far today.`} Not part of the reward.
                        </small>
                      </div>
                      {canEdit && (
                        <div className="tg-rowtools" style={{ marginLeft: 'auto' }}>
                          <Button size="mini" onClick={() => onEditDaily(progress!.metric)}>Edit</Button>
                          <Button size="mini" aria-label={`Delete the daily target for ${label}`} onClick={() => onRemoveDaily(progress!)}>Delete</Button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
