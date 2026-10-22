import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Laptop, Monitor, Smartphone } from 'lucide-react';
import { Button, Card, Input, Tag, useToast } from '../../components/ui-v2';
import { accountService, type SessionRow } from '../../services/account.service';
import { authService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';

const apiMessage = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

const deviceIcon = (label: string | null) => (/iphone|android|ipad|phone/i.test(label ?? '') ? Smartphone : /windows|linux/i.test(label ?? '') ? Monitor : Laptop);

const lastSeen = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'Now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
};

function PasswordCard({ onChanged }: { onChanged: () => void }) {
  const say = useToast();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (form.next !== form.repeat) return setError('The two new passwords do not match');
    setSaving(true);
    try {
      await accountService.changePassword(form.current, form.next);
      setForm({ current: '', next: '', repeat: '' });
      say('Password changed. Other devices are signed out.');
      onChanged();
    } catch (err) {
      setError(apiMessage(err, 'The password could not be changed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Password">
      <form onSubmit={submit}>
        <div className="fields">
          <Input label="Current password" type="password" className="full" value={form.current} onChange={set('current')} placeholder="Your current password" autoComplete="current-password" />
          <Input label="New password" type="password" value={form.next} onChange={set('next')} placeholder="At least 8 characters" hint="Use upper and lower case letters, a number and a symbol." autoComplete="new-password" />
          <Input label="Repeat new password" type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" />
        </div>
        {error && (
          <div className="fl" style={{ padding: '10px 20px 0' }}>
            <p className="err" role="alert">{error}</p>
          </div>
        )}
        <div className="cardfoot">
          <Button variant="primary" type="submit" disabled={saving || !form.current || !form.next}>Change password</Button>
        </div>
      </form>
    </Card>
  );
}

function SessionsCard({ reloadKey }: { reloadKey: number }) {
  const say = useToast();
  const [rows, setRows] = useState<SessionRow[] | null>(null);

  const load = useCallback(() => {
    accountService.listSessions().then(setRows).catch(() => setRows([]));
  }, []);
  useEffect(load, [load, reloadKey]);

  const signOut = async (id: number) => {
    try {
      await accountService.revokeSession(id);
      say('Signed out');
    } catch (err) {
      say(apiMessage(err, 'That session could not be signed out'));
    }
    load();
  };

  const signOutOthers = async () => {
    try {
      const n = await accountService.revokeOthers();
      say(n === 1 ? 'Signed out of 1 other place' : `Signed out of ${n} other places`);
    } catch (err) {
      say(apiMessage(err, 'The other sessions could not be signed out'));
    }
    load();
  };

  const others = rows?.filter((r) => !r.current).length ?? 0;
  return (
    <Card
      title="Where you are signed in"
      aside={<Button size="mini" disabled={others === 0} onClick={signOutOthers}>Sign out everywhere else</Button>}
    >
      <div style={{ marginTop: 8 }}>
        {rows?.map((r) => {
          const Icon = deviceIcon(r.deviceLabel);
          return (
            <div className="sess" key={r.id}>
              <span className="ico"><Icon aria-hidden="true" /></span>
              <div>
                <b>{r.deviceLabel || 'Unknown device'}</b>
                <small>{r.ip ? `IP ${r.ip} · ` : ''}{r.current ? 'Now' : lastSeen(r.lastSeenAt)}</small>
              </div>
              {r.current ? <Tag tone="ok">This device</Tag> : <Button size="mini" onClick={() => signOut(r.id)}>Sign out</Button>}
            </div>
          );
        })}
        {rows?.length === 0 && <p className="setnote">No sessions to show.</p>}
      </div>
    </Card>
  );
}

function DangerCard({ isOwner }: { isOwner: boolean }) {
  const navigate = useNavigate();
  const say = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();

  const exportData = async () => {
    setExporting(true);
    try {
      await accountService.exportMyData();
      say('Your data is downloading');
    } catch {
      say('Your data could not be exported');
    } finally {
      setExporting(false);
    }
  };

  const cancel = () => {
    setConfirming(false);
    setPassword('');
    setTyped('');
    setError(undefined);
  };

  const remove = async () => {
    setError(undefined);
    setDeleting(true);
    try {
      await authService.deleteAccount(password, typed);
      useAuthStore.getState().logout(false);
      useConfigStore.getState().reset();
      navigate('/login');
    } catch (err) {
      setError(apiMessage(err, 'The account could not be deleted'));
      setDeleting(false);
    }
  };

  return (
    <Card className="danger" title="Danger zone">
      <div className="dzrow">
        {isOwner ? (
          <p><b style={{ color: 'var(--ink)' }}>Delete your account</b><br />This removes your login, all orders, customers and messages. It cannot be undone. Export your data first.</p>
        ) : (
          <p><b style={{ color: 'var(--ink)' }}>Export your data</b><br />Download your profile, sessions and the records you created as a ZIP of CSV files.</p>
        )}
        <Button disabled={exporting} onClick={exportData}>Export my data</Button>
        {isOwner && !confirming && <Button variant="danger" onClick={() => setConfirming(true)}>Delete account</Button>}
      </div>
      {isOwner && confirming && (
        <div className="confirm">
          <Input label="Your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <Input label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" autoComplete="off" />
          {error && (
            <div className="fl">
              <p className="err" role="alert">{error}</p>
            </div>
          )}
          <div className="row">
            <Button variant="danger" disabled={typed !== 'DELETE' || !password || deleting} onClick={remove}>Delete everything</Button>
            <Button onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Security (M3-T64, F-1223 to F-1226): password, signed-in sessions, export my data, delete account (owner). */
export function SecurityTab() {
  const isOwner = useAuthStore((s) => s.user?.role) === 'super_admin';
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <PasswordCard onChanged={() => setReloadKey((k) => k + 1)} />
      <SessionsCard reloadKey={reloadKey} />
      <DangerCard isOwner={isOwner} />
    </>
  );
}
