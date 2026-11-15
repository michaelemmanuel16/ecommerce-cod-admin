import { useEffect, useState } from 'react';
import { Button, Input, Modal, useToast } from '../../components/ui-v2';
import { connectionsService, type PaymentConnection } from '../../services/connections.service';
import { apiErrorMessage } from '../../utils/apiError';
import { CopyButton } from './parts';
import { useDialogForm } from './useDialogForm';

interface Props {
  open: boolean;
  connection: PaymentConnection | null;
  webhookUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Paystack keys, saved to /api/payment-connections. The API refuses a key whose prefix does not match the mode; its sentence is shown. */
export function PaystackDialog({ open, connection, webhookUrl, onClose, onSaved }: Props) {
  const say = useToast();
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [publicKey, setPublicKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const { saving, setSaving, error, setError } = useDialogForm(open, connection);

  useEffect(() => {
    if (!open) return;
    setMode(connection?.mode ?? 'test');
    setPublicKey(connection?.publicKey ?? '');
    setSecretKey(connection?.secretKey ?? '');
    setIsEnabled(connection?.isEnabled ?? true);
  }, [open, connection]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const saved = await connectionsService.savePaymentConnection({
        provider: 'paystack', mode, publicKey: publicKey.trim() || null, secretKey: secretKey || null, isEnabled,
      });
      say('Paystack saved');
      // Check the keys at once; a failed check is told, not hidden. The keys stay saved.
      if (saved.id !== null) {
        try {
          const check = await connectionsService.testPaymentConnection(saved.id);
          if (!check.ok) say(check.message);
        } catch { /* the card shows the problem if Paystack refuses the keys */ }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e, 'The Paystack keys could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open} onClose={onClose} title="Paystack"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></>}
    >
      <div className="cxd stack">
        {error && <div className="strip bad" role="alert">{error}</div>}
        <div>
          <span className="lab" id="pk-mode">Mode</span>
          <div className="seg" role="group" aria-labelledby="pk-mode">
            <button type="button" className={mode === 'test' ? 'on' : ''} aria-pressed={mode === 'test'} onClick={() => setMode('test')}>Test</button>
            <button type="button" className={mode === 'live' ? 'on' : ''} aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live</button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>{mode === 'test' ? 'Test mode uses test keys. No real money moves.' : 'Live mode uses live keys. Buyers pay real money into your Paystack account.'}</p>
        </div>
        <Input label="Public key" className="mono" value={publicKey} onChange={(e) => setPublicKey(e.target.value)} placeholder={mode === 'live' ? 'pk_live_...' : 'pk_test_...'} autoComplete="off" />
        <Input label="Secret key" className="mono" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={mode === 'live' ? 'sk_live_...' : 'sk_test_...'} autoComplete="off" hint="Saved keys are hidden. Leave this as it is to keep the saved key." />
        <label className="accrow">
          <div><b>Take Paystack payments</b><small>Turn this off to stop online payments at checkout.</small></div>
          <input type="checkbox" style={{ marginLeft: 'auto' }} checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} aria-label="Take Paystack payments" />
        </label>
        {webhookUrl && (
          <div>
            <span className="lab">Webhook URL</span>
            <div className="rowf" style={{ alignItems: 'center' }}>
              <div className="code" style={{ flex: 1 }}>{webhookUrl}</div>
              <CopyButton text={webhookUrl} />
            </div>
            <p className="hint" style={{ marginTop: 5 }}>Paste this in Paystack under Settings, API keys and webhooks.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
