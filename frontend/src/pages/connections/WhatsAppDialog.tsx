import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Input, Modal, useToast } from '../../components/ui-v2';
import { adminService, type SystemConfig, type WABAPhoneNumber } from '../../services/admin.service';
import { apiErrorMessage } from '../../utils/apiError';

interface Props {
  open: boolean;
  config: SystemConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * WhatsApp Business: "Connect with Meta" (OAuth, in this tab; Meta sends the browser back to /connections) or "Use a token"
 * (the manual fields, the old Settings form). The manual path saves to the same place the old Integrations tab did.
 */
export function WhatsAppDialog({ open, config, onClose, onSaved }: Props) {
  const say = useToast();
  const [mode, setMode] = useState<'meta' | 'manual'>('meta');
  const [oauthOn, setOauthOn] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'save' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const wa = config?.whatsappProvider;
  const viaMeta = wa?.authMode === 'oauth';

  useEffect(() => {
    if (!open) return;
    setMode(wa?.accessToken && !viaMeta ? 'manual' : 'meta');
    setAccessToken(wa?.accessToken ?? '');
    setPhoneNumberId(wa?.phoneNumberId ?? '');
    setAppSecret(wa?.appSecret ?? '');
    setVerifyToken(wa?.webhookVerifyToken ?? '');
    setIsEnabled(wa?.isEnabled !== false);
    setError(null);
    setNote(null);
    setOauthOn(null);
    adminService.checkWhatsAppOAuthEnabled().then((r) => setOauthOn(r.enabled)).catch(() => setOauthOn(false));
  }, [open, wa, viaMeta]);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const { authUrl } = await adminService.initiateWhatsAppOAuth();
      // Same tab: Meta sends the browser back to Connections (no new tab, the in-app browsers lose it)
      window.location.assign(authUrl);
    } catch (e) {
      setError(apiErrorMessage(e, 'The Meta login could not start.'));
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setError(null);
    try {
      await adminService.disconnectWhatsAppOAuth();
      say('WhatsApp disconnected');
      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'WhatsApp could not be disconnected.'));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    if (!accessToken.trim() || !phoneNumberId.trim()) { setError('Enter the access token and the phone number ID.'); return; }
    setBusy('save');
    try {
      await adminService.updateSystemConfig({
        whatsappProvider: { accessToken: accessToken.trim(), phoneNumberId: phoneNumberId.trim(), appSecret, webhookVerifyToken: verifyToken, isEnabled, authMode: 'manual' },
      });
      say('WhatsApp saved');
      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'The WhatsApp settings could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    setBusy('check');
    setNote(null);
    try {
      const s = await adminService.getWhatsAppStatus();
      if (!s.configured) setNote({ ok: false, text: 'WhatsApp is not set up yet. Save your token first.' });
      else if (s.error) setNote({ ok: false, text: s.error });
      else setNote({ ok: true, text: `Connected as ${s.verifiedName ?? 'your number'}${s.displayPhoneNumber ? ` (${s.displayPhoneNumber})` : ''}.` });
    } catch (e) {
      setNote({ ok: false, text: apiErrorMessage(e, 'The check failed.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="WhatsApp Business"
      footer={mode === 'manual'
        ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving...' : 'Save'}</Button></>
        : <Button onClick={onClose}>Close</Button>}
    >
      <div className="cxd stack">
        {error && <div className="strip bad" role="alert">{error}</div>}
        <div>
          <span className="lab" id="wa-mode">How do you want to connect?</span>
          <div className="seg" role="group" aria-labelledby="wa-mode">
            <button type="button" className={mode === 'meta' ? 'on' : ''} aria-pressed={mode === 'meta'} onClick={() => setMode('meta')}>Connect with Meta</button>
            <button type="button" className={mode === 'manual' ? 'on' : ''} aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>Use a token</button>
          </div>
        </div>

        {mode === 'meta' && (
          <>
            {viaMeta && (
              <div className="strip ok" role="status">
                <CheckCircle2 aria-hidden="true" size={15} />
                <span>Connected as {wa?.oauthVerifiedName ?? 'your business'}{wa?.oauthDisplayPhone ? ` (${wa.oauthDisplayPhone})` : ''}.</span>
              </div>
            )}
            {oauthOn === false && <div className="strip warn">Login with Meta is not set up on this server. Use a token instead.</div>}
            <p className="hint">Log in with Meta, then pick the WhatsApp number customers will reply to.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={connect} disabled={busy === 'connect' || oauthOn === false}>
                {busy === 'connect' ? 'Opening Meta...' : viaMeta ? 'Reconnect with Meta' : 'Connect with Meta'}
              </Button>
              {viaMeta && <Button onClick={disconnect} disabled={busy === 'disconnect'}>{busy === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}</Button>}
            </div>
          </>
        )}

        {mode === 'manual' && (
          <>
            <Input label="Access token" type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="EAAx..." />
            <div className="row2">
              <Input label="Phone number ID" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
              <Input label="App secret" optional type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
            </div>
            <Input label="Webhook verify token" optional value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} hint="Paste this into Meta when it asks for a verify token." />
            <label className="accrow">
              <div><b>Send WhatsApp messages</b><small>Turn this off to stop all WhatsApp messages.</small></div>
              <input type="checkbox" style={{ marginLeft: 'auto' }} checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} aria-label="Send WhatsApp messages" />
            </label>
            <div>
              <Button onClick={check} disabled={busy === 'check'}>{busy === 'check' ? 'Checking...' : 'Check connection'}</Button>
              <p className="hint" style={{ marginTop: 5 }}>Save first, then check.</p>
              {note && <div className={`strip ${note.ok ? 'ok' : 'bad'}`} role={note.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>{note.text}</div>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

interface PickerProps {
  phones: WABAPhoneNumber[] | null;
  onPick: (phone: WABAPhoneNumber) => Promise<void>;
  onClose: () => void;
}

/** After the Meta login with more than one number: pick the one customers reply to. */
export function WhatsAppPhonePicker({ phones, onPick, onClose }: PickerProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setChosen(phones?.[0]?.id ?? null); }, [phones]);
  const phone = phones?.find((p) => p.id === chosen);
  return (
    <Modal
      open={!!phones} onClose={onClose} title="Pick your WhatsApp number" description="Customers reply to this number."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!phone || saving} onClick={async () => { if (!phone) return; setSaving(true); try { await onPick(phone); } finally { setSaving(false); } }}>
            {saving ? 'Saving...' : 'Use this number'}
          </Button>
        </>
      }
    >
      <div className="cxd stack">
        {(phones ?? []).map((p) => (
          <label key={p.id} className="accrow">
            <input type="radio" name="wa-phone" checked={chosen === p.id} onChange={() => setChosen(p.id)} />
            <div><b>{p.display_phone_number}</b><small>{p.verified_name}</small></div>
          </label>
        ))}
      </div>
    </Modal>
  );
}
