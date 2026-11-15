import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '../../components/ui-v2';
import { adminService, type SystemConfig } from '../../services/admin.service';
import { connectionsService } from '../../services/connections.service';
import { apiErrorMessage } from '../../utils/apiError';

interface Props {
  open: boolean;
  config: SystemConfig | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Arkesel SMS: the API key (shown masked), the sender ID, the switch, and a test message. */
export function SmsDialog({ open, config, onClose, onSaved }: Props) {
  const say = useToast();
  const [authToken, setAuthToken] = useState('');
  const [senderId, setSenderId] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const p = config?.smsProvider;
    setAuthToken(p?.authToken ?? '');
    setSenderId(p?.senderId ?? '');
    setIsEnabled(p?.isEnabled !== false);
    setPhone('');
    setError(null);
    setTestNote(null);
  }, [open, config]);

  const save = async () => {
    setError(null);
    if (!authToken.trim()) { setError('Enter your Arkesel API key.'); return; }
    setSaving(true);
    try {
      await adminService.updateSystemConfig({ smsProvider: { provider: 'arkesel', authToken: authToken.trim(), senderId: senderId.trim(), isEnabled } });
      say('SMS settings saved');
      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'The SMS settings could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!phone.trim()) { setTestNote({ ok: false, text: 'Enter a phone number first.' }); return; }
    setTesting(true);
    setTestNote(null);
    try {
      await connectionsService.sendSmsTest(phone.trim());
      setTestNote({ ok: true, text: 'Test message sent.' });
    } catch (e) {
      setTestNote({ ok: false, text: apiErrorMessage(e, 'The test message could not be sent. Save your settings first.') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Arkesel SMS"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></>}
    >
      <div className="cxd stack">
        {error && <div className="strip bad" role="alert">{error}</div>}
        <Input label="API key" type="password" autoComplete="off" value={authToken} onChange={(e) => setAuthToken(e.target.value)} hint="Found in the Arkesel dashboard under API keys." />
        <Input label="Sender ID" maxLength={11} value={senderId} onChange={(e) => setSenderId(e.target.value.slice(0, 11))} hint="Up to 11 characters. Customers see this as the sender. It must be registered with Arkesel." />
        <label className="accrow">
          <div><b>Send SMS</b><small>Turn this off to stop all text messages.</small></div>
          <input type="checkbox" style={{ marginLeft: 'auto' }} checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} aria-label="Send SMS" />
        </label>
        <div>
          <div className="rowf">
            <Input label="Send a test to" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 555 0100" />
            <Button onClick={sendTest} disabled={testing}>{testing ? 'Sending...' : 'Send test'}</Button>
          </div>
          <p className="hint" style={{ marginTop: 5 }}>Save your key first, then send the test.</p>
          {testNote && <div className={`strip ${testNote.ok ? 'ok' : 'bad'}`} role={testNote.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>{testNote.text}</div>}
        </div>
      </div>
    </Modal>
  );
}
