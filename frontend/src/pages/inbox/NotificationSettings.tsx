import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Select, Skeleton, useToast } from '../../components/ui-v2';
import {
  CHANNELS, notificationSettingsService, type Channel, type PreferenceRow,
} from '../../services/notificationSettings.service';
import { apiErrorMessage } from '../../utils/apiError';

const CHANNEL_LABEL: Record<Channel, string> = { inApp: 'In-app', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS' };
const OWNER_ROLES = ['admin', 'super_admin'];
const ROLE_CHOICES: Array<{ id: string; label: string }> = [
  { id: 'admin', label: 'Admin' }, { id: 'manager', label: 'Manager' }, { id: 'sales_rep', label: 'Call rep' },
  { id: 'delivery_agent', label: 'Delivery agent' }, { id: 'inventory_manager', label: 'Inventory manager' }, { id: 'accountant', label: 'Accountant' },
];

interface Props {
  /** The person whose settings these are. The agent app (M10) passes its own user. */
  user: { id: number; role: string };
}

type Mode = 'mine' | 'roles';

/**
 * Notification settings (M9-T39, F-555, F-1227, F-1228): "My notifications" is the person's own choice for each event
 * and channel; "Role defaults" (owner and admin) is what a role starts with. Each switch saves at once through the API.
 * A channel the business has not connected is disabled, with the API's hint.
 */
export function NotificationSettings({ user }: Props) {
  const say = useToast();
  const isOwner = OWNER_ROLES.includes(user.role);
  const [mode, setMode] = useState<Mode>('mine');
  const [role, setRole] = useState('manager');
  const [rows, setRows] = useState<PreferenceRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const forRoles = mode === 'roles' && isOwner;

  const load = useCallback(async () => {
    setRows(null);
    setFailed(false);
    try {
      setRows(forRoles ? await notificationSettingsService.roleDefaults(role) : await notificationSettingsService.mine());
    } catch {
      setFailed(true);
    }
  }, [forRoles, role, user.id]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (row: PreferenceRow, ch: Channel) => {
    const next = !row.channels[ch].enabled;
    const key = `${row.event}:${ch}`;
    setSaving(key);
    try {
      const change = [{ event: row.event, [ch]: next }];
      setRows(forRoles ? await notificationSettingsService.saveRoleDefaults(role, change) : await notificationSettingsService.saveMine(change));
    } catch (e) {
      say(apiErrorMessage(e, 'The change was not saved'));
    } finally {
      setSaving(null);
    }
  };

  // One hint per channel that is not connected (the API sends the same sentence on every row)
  const hints = rows ? CHANNELS.map((ch) => ({ ch, hint: rows.map((r) => r.channels[ch]).find((c) => !c.available)?.hint })) : [];

  return (
    <div className="card nset">
      <div className="sub">
        <h3>Notification settings</h3>
        {isOwner && (
          <div className="seg" role="group" aria-label="Whose settings">
            <button type="button" className={mode === 'mine' ? 'on' : ''} aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>My notifications</button>
            <button type="button" className={mode === 'roles' ? 'on' : ''} aria-pressed={mode === 'roles'} onClick={() => setMode('roles')}>Role defaults</button>
          </div>
        )}
      </div>

      {forRoles && (
        <div className="nset-note">
          <p>What a role starts with. Anyone who has changed their own settings keeps them.</p>
          <Select label="Role" compact value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_CHOICES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </div>
      )}

      {failed ? (
        <EmptyState title="The settings did not load" text="Check your connection and try again." action={<Button onClick={() => void load()}>Try again</Button>} />
      ) : !rows ? (
        <div aria-busy="true" aria-label="Loading"><Skeleton height={44} /><Skeleton height={44} /><Skeleton height={44} /></div>
      ) : (
        <>
          {hints.some((h) => h.hint) && (
            <ul className="nset-hints">
              {hints.filter((h) => h.hint).map((h) => (
                <li key={h.ch}><b>{CHANNEL_LABEL[h.ch]}:</b> {h.hint}</li>
              ))}
              {isOwner && <li><Link to="/connections">Open Connections</Link></li>}
            </ul>
          )}
          <div className="tablewrap">
            <table className="mx">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  {CHANNELS.map((ch) => <th key={ch} scope="col">{CHANNEL_LABEL[ch]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.event}>
                    <td><b>{row.label}</b></td>
                    {CHANNELS.map((ch) => {
                      const c = row.channels[ch];
                      const off = !c.available;
                      const title = off ? c.hint : c.locked ? 'The owner always gets this one in the app' : undefined;
                      return (
                        <td key={ch}>
                          <button
                            type="button"
                            className="sw"
                            role="switch"
                            aria-checked={c.enabled}
                            aria-label={`${row.label}: ${CHANNEL_LABEL[ch]}`}
                            title={title}
                            disabled={off || !!c.locked || saving === `${row.event}:${ch}`}
                            onClick={() => void toggle(row, ch)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
