import { Fragment, useState } from 'react';
import { ChevronDown, PhoneCall, TrendingUp } from 'lucide-react';
import { Button, Card, EmptyState, Tag } from '../../components/ui-v2';
import type { Calculators, DailyProgress } from '../../services/targets.service';
import { compactMoney } from '../dashboard/format';
import { NO_PAYOUT, SET_A_TARGET, VACANT, barClass, formatCount, monthName, type HolderLine, type RoleGroup } from './model';

export interface RowAction {
  /** Open the form for a holder, or for the whole role when `line` is null. */
  edit: (group: RoleGroup, line: HolderLine | null) => void;
  remove: (line: HolderLine) => void;
}

export interface DailyRow { label: string; progress: DailyProgress }

interface Props {
  month: string;
  groups: RoleGroup[];
  currency: string;
  /** "Feeds October GH₵180k: ..." from the calculators; null while they load or when they cannot answer. */
  feeds: Calculators | null;
  /** The daily targets that are set; shown for the current month only. */
  daily: DailyRow[];
  /** Show Edit and Delete (the person may set targets). */
  canEdit: boolean;
  actions: RowAction;
  onEditDaily: (metric: string) => void;
  onRemoveDaily: (progress: DailyProgress) => void;
  onOpenFinance: () => void;
}

const avatarClass = (kind: string) => (kind === 'ai_agent' ? 'a ai' : kind === 'company' ? 'a co' : 'a');

/** A progress bar (role="progressbar"): the tone is the status key's, never worked out from the number here. */
function Bar({ percent, tone, label }: { percent: number; tone?: string; label: string }) {
  return (
    <div className="prog" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} style={{ marginTop: 0 }}>
      <i className={tone} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

/** "October targets by role" (F-1102): a group per role, holders with target, progress, status and the reward at 100%. */
export function RoleGroups({ month, groups, currency, feeds, daily, canEdit, actions, onEditDaily, onRemoveDaily, onOpenFinance }: Props) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const span = canEdit ? 6 : 5;

  return (
    <Card title={`${monthName(month)} targets by role`} aside={<Button size="mini" onClick={onOpenFinance}>{`${monthName(month)} in Finance`}</Button>}>
      {feeds && (
        <div className="tg-feeds">
          <TrendingUp aria-hidden />
          <span>
            Feeds {monthName(month)} {compactMoney(feeds.revenueTarget, currency)}: {formatCount(feeds.ordersDelivered)} delivered orders × {compactMoney(feeds.plannedAov, currency)} planned order value;
            {' '}{formatCount(feeds.ordersToTakeIn)} orders to take in, {feeds.ordersPerDay} a day.
          </span>
        </div>
      )}
      <p className="tg-note">A role can be held by a person, an AI agent or a company. Rewards are set in the Rewards setting.</p>
      {groups.length === 0 ? (
        <EmptyState title="No role targets yet" text="A role target shows here once it is set. Use Add target." />
      ) : (
        <div className="tablewrap tg-scroll">
          <table className="tg-table">
            <thead>
              <tr><th>Who</th><th>Their target</th><th style={{ width: '30%' }}>Progress</th><th>Status</th><th className="r">Reward at 100%</th>{canEdit && <th><span className="sr-only">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const hidden = closed.has(g.role.roleId);
                return (
                  <Fragment key={g.role.roleId}>
                    <tr className="tg-grp">
                      <td colSpan={span}>
                        <div className="tg-gwrap">
                          <div>
                            <button type="button" className="tg-gt" aria-expanded={!hidden} aria-label={`Show or hide ${g.role.roleName}`} onClick={() => toggle(g.role.roleId)}><ChevronDown /></button>
                            <b>{g.role.roleName}</b> <Tag>{g.vacant ? VACANT : g.holderCount}</Tag>
                            <small>{g.roleTargetText}</small>
                          </div>
                          <div>
                            {g.bar && (
                              <>
                                <Bar percent={g.bar.percent} label={`${g.role.roleName} progress to the role target`} />
                                <small>{g.bar.text}</small>
                              </>
                            )}
                            {canEdit && <Button size="mini" onClick={() => actions.edit(g, null)}>{g.role.target ? 'Edit role target' : 'Set role target'}</Button>}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {!hidden && g.lines.map((l) => (
                      <tr key={l.holder.userId} className="tg-row">
                        <td data-label="Who">
                          <div className="tg-who">
                            <div className={avatarClass(l.holder.kind)}>{l.initials}</div>
                            <div>
                              {l.holder.name} {l.holder.kind === 'ai_agent' && <Tag tone="v">AI agent</Tag>}
                              <small>{g.role.roleName}</small>
                            </div>
                          </div>
                        </td>
                        <td data-label="Their target">{l.targetText ?? <span className="tg-nodata">{SET_A_TARGET}</span>}</td>
                        <td data-label="Progress">
                          {l.bar !== null && <Bar percent={l.bar} tone={barClass(l.status?.tone)} label={`${l.holder.name} progress to their target`} />}
                          <small className={l.noData ? 'tg-nodata' : ''} style={{ color: 'var(--ink-3)' }}>{l.detail}</small>
                        </td>
                        <td data-label="Status">{l.status ? <Tag tone={l.status.tone}>{l.status.label}</Tag> : <span className="tg-nodata">—</span>}</td>
                        <td data-label="Reward at 100%" className="r"><span className={`tg-reward${l.reward === NO_PAYOUT || l.reward === '—' ? ' none' : ''}`} title={l.rewardTitle}>{l.reward}</span></td>
                        {canEdit && (
                          <td className="tg-act">
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
              {daily.map(({ label, progress }) => (
                <tr key={progress.metric} className="tg-row">
                  <td colSpan={span}>
                    <div className="tg-who">
                      <div className="a"><PhoneCall style={{ width: 15, height: 15 }} aria-hidden /></div>
                      <div>
                        Daily target: {label}
                        <small>
                          {progress.target} a day.{progress.message ? ` ${progress.message}.` : ` ${progress.actual ?? 0} so far today.`} Not part of the reward.
                        </small>
                      </div>
                      {canEdit && (
                        <div className="tg-rowtools" style={{ marginLeft: 'auto' }}>
                          <Button size="mini" onClick={() => onEditDaily(progress.metric)}>Edit</Button>
                          <Button size="mini" aria-label={`Delete the daily target for ${label}`} onClick={() => onRemoveDaily(progress)}>Delete</Button>
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
