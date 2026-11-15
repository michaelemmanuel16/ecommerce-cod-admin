import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { adminService, type SystemConfig } from '../../services/admin.service';
import { connectionsService } from '../../services/connections.service';
import { useAuthStore } from '../../stores/authStore';
import { apiErrorMessage } from '../../utils/apiError';

interface Props {
  open: boolean;
  config: SystemConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

type Provider = 'sendgrid' | 'resend' | 'smtp';

/**
 * Email: the CodAdmin sender (Resend) works with no setup. This dialog adds the store's own sender: SendGrid, Resend or SMTP.
 * "Send test email" on the SMTP form tests the typed fields; the server's own error text is shown when it fails.
 */
export function EmailDialog({ open, config, onClose, onSaved }: Props) {
  const say = useToast();
  const me = useAuthStore((s) => s.user);
  const [provider, setProvider] = useState<Provider>('sendgrid');
  const [apiKey, setApiKey] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const p = config?.emailProvider as (SystemConfig['emailProvider'] & { smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; smtpUser?: string }) | undefined;
    setProvider((p?.provider as Provider) || 'sendgrid');
    setApiKey(p?.apiKey ?? '');
    setFromEmail(p?.fromEmail ?? '');
    setFromName(p?.fromName ?? '');
    setHost(p?.smtpHost ?? '');
    setPort(String(p?.smtpPort ?? 587));
    setSecure(!!p?.smtpSecure);
    setUser(p?.smtpUser ?? '');
    setError(null);
    setTestNote(null);
  }, [open, config]);

  const smtp = provider === 'smtp';

  const save = async () => {
    setError(null);
    if (!apiKey.trim()) { setError(smtp ? 'Enter the SMTP password.' : 'Enter the API key.'); return; }
    if (!fromEmail.trim()) { setError('Enter the from address.'); return; }
    setSaving(true);
    try {
      await adminService.updateSystemConfig({
        emailProvider: {
          provider, apiKey: apiKey.trim(), fromEmail: fromEmail.trim(), fromName: fromName.trim(),
          ...(smtp ? { smtpHost: host.trim(), smtpPort: Number(port) || 587, smtpSecure: secure, smtpUser: user.trim() } : {}),
        },
      } as Partial<SystemConfig>);
      say('Email settings saved');
      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'The email settings could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestNote(null);
    try {
      if (smtp) {
        const res = await connectionsService.testSmtp({
          smtpHost: host.trim() || undefined, smtpPort: Number(port) || undefined, smtpSecure: secure,
          smtpUser: user.trim() || undefined, password: apiKey || undefined, fromEmail: fromEmail.trim() || undefined,
        });
        setTestNote({ ok: true, text: `Test email sent to ${res.sentTo}.` });
      } else {
        if (!me?.email) throw new Error('no email');
        await connectionsService.sendEmailTest(me.email);
        setTestNote({ ok: true, text: `Test email sent to ${me.email}.` });
      }
    } catch (e) {
      setTestNote({ ok: false, text: apiErrorMessage(e, 'The test email could not be sent. Save your settings first.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Email"
      description="Until you add a sender, email goes out from the CodAdmin sender."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></>}
    >
      <div className="cxd stack">
        {error && <div className="strip bad" role="alert">{error}</div>}
        <Select label="Sender" value={provider} onChange={(e) => { setProvider(e.target.value as Provider); setTestNote(null); }}>
          <option value="sendgrid">SendGrid</option>
          <option value="resend">Resend (your own account)</option>
          <option value="smtp">SMTP</option>
        </Select>
        {smtp && (
          <>
            <div className="row2">
              <Input label="Host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.mail.example" />
              <Input label="Port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <Input label="Username" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Often your from address" autoComplete="off" />
            <label className="accrow">
              <div><b>Secure connection (SSL)</b><small>Turn on for port 465. Leave off for port 587.</small></div>
              <input type="checkbox" style={{ marginLeft: 'auto' }} checked={secure} onChange={(e) => setSecure(e.target.checked)} aria-label="Secure connection" />
            </label>
          </>
        )}
        <Input label={smtp ? 'Password' : 'API key'} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} hint="Saved keys are hidden. Leave this as it is to keep the saved one." />
        <div className="row2">
          <Input label="From name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          <Input label="From email" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
        </div>
        <div>
          <Button onClick={sendTest} disabled={testing}>{testing ? 'Sending...' : 'Send test email'}</Button>
          <p className="hint" style={{ marginTop: 5 }}>
            {smtp ? `Sends one email to ${me?.email ?? 'you'} with the fields above.` : `Sends one email to ${me?.email ?? 'you'} with your saved settings. Save first.`}
          </p>
          {testNote && <div className={`strip ${testNote.ok ? 'ok' : 'bad'}`} role={testNote.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>{testNote.text}</div>}
        </div>
      </div>
    </Modal>
  );
}
