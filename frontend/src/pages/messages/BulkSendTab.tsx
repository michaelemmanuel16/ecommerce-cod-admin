import { useEffect, useState } from 'react';
import { Send, Users } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Input, Select, Table, useToast } from '../../components/ui-v2';
import { WHATSAPP_TEMPLATE_OPTIONS } from '../../constants/workflow';
import { communicationService, type BulkSendResult, type Recipient, type SmsTemplate } from '../../services/communication.service';
import { productsService } from '../../services/products.service';
import type { Product } from '../../types';
import { apiMessage } from '../orders/importText';
import { countText } from './format';

type Channel = 'sms' | 'whatsapp';
const SHOWN = 50;

/**
 * Bulk send, as it was on Communications (SMS or WhatsApp to a filtered list), in v2 style. The send goes through the
 * backend's messageSender: an opted-out customer is skipped there, and the answer counts it. Owner and admin only.
 */
export function BulkSendTab() {
  const say = useToast();
  const [channel, setChannel] = useState<Channel>('sms');
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [text, setText] = useState('');
  const [whatsappKey, setWhatsappKey] = useState('');
  const [link, setLink] = useState('');
  const [state, setState] = useState('');
  const [productId, setProductId] = useState('');
  const [hasOrdered, setHasOrdered] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<(BulkSendResult & { channel: Channel }) | null>(null);

  useEffect(() => {
    communicationService.getTemplates().then(setTemplates, () => setTemplates([]));
    productsService.getProducts().then((p) => setProducts(p.filter((x) => x.isActive)), () => setProducts([]));
  }, []);

  // A change to the channel or the filters makes the found list stale
  const stale = () => { setRecipients(null); setResult(null); };

  const find = async () => {
    setFinding(true);
    setResult(null);
    try {
      setRecipients(await communicationService.getRecipients({ channel, ...(state.trim() && { state: state.trim() }), ...(productId && { productId }), ...(hasOrdered && { hasOrdered: true }) }));
    } catch (err) {
      say(await apiMessage(err, 'The recipients did not load'));
    } finally {
      setFinding(false);
    }
  };

  const ready = channel === 'sms' ? text.trim().length > 0 : whatsappKey !== '';
  const count = recipients?.length ?? 0;

  const send = async () => {
    if (!recipients) return;
    setSending(true);
    try {
      const ids = recipients.map((r) => r.id);
      const answer = channel === 'sms'
        ? await communicationService.bulkSendSms(ids, text.trim())
        : await communicationService.bulkSendWhatsApp(ids, whatsappKey, link.trim() || undefined);
      setResult({ ...answer, channel });
      setRecipients(null);
      setConfirm(false);
      say(`${countText(answer.results.filter((r) => r.success).length)} sent${answer.skipped ? `, ${countText(answer.skipped)} skipped` : ''}`);
    } catch (err) {
      setConfirm(false);
      say(await apiMessage(err, 'The messages were not sent'));
    } finally {
      setSending(false);
    }
  };

  const sentCount = result?.results.filter((r) => r.success).length ?? 0;
  const failedCount = result?.results.filter((r) => !r.success && !r.skipped).length ?? 0;

  return (
    <div className="bulkform" role="tabpanel" aria-label="Bulk send">
      <div>
        <div className="fld">
          <span className="lab" id="bulk-ch">Channel</span>
          <div className="seg" role="group" aria-labelledby="bulk-ch">
            <button type="button" className={channel === 'sms' ? 'on' : undefined} aria-pressed={channel === 'sms'} onClick={() => { setChannel('sms'); stale(); }}>SMS</button>
            <button type="button" className={channel === 'whatsapp' ? 'on' : undefined} aria-pressed={channel === 'whatsapp'} onClick={() => { setChannel('whatsapp'); stale(); }}>WhatsApp</button>
          </div>
        </div>

        {channel === 'sms' ? (
          <>
            <div className="fld">
              <Select label="Saved template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); const t = templates.find((x) => String(x.id) === e.target.value); if (t) setText(t.body); }}>
                <option value="">Write my own</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div className="fld fl">
              <label htmlFor="bulk-text">Text</label>
              <textarea id="bulk-text" rows={5} value={text} placeholder="Write your SMS" onChange={(e) => setText(e.target.value)} />
              <p className="hint">{text.length} characters</p>
            </div>
          </>
        ) : (
          <>
            <div className="fld">
              <Select label="WhatsApp template" value={whatsappKey} onChange={(e) => setWhatsappKey(e.target.value)}>
                <option value="">Pick a template</option>
                {WHATSAPP_TEMPLATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <div className="fld">
              <Input label="Custom link" optional type="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
            </div>
          </>
        )}

        <div className="fld">
          <span className="lab">Who gets it</span>
          <div className="two2">
            <Input label="Region" placeholder="e.g. Greater Accra" value={state} onChange={(e) => { setState(e.target.value); stale(); }} />
            <Select label="Bought" value={productId} onChange={(e) => { setProductId(e.target.value); stale(); }}>
              <option value="">Any product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <label className="cmpsw bulkchk">
            <input type="checkbox" checked={hasOrdered} onChange={(e) => { setHasOrdered(e.target.checked); stale(); }} />
            <span className="tg" />
            Has ordered before
          </label>
        </div>
        <div className="sendrow">
          <Button onClick={() => void find()} disabled={finding}><Users style={{ width: 15, height: 15 }} />{finding ? 'Finding' : 'Find recipients'}</Button>
        </div>
      </div>

      <div className="card sum">
        {recipients === null && !result && (
          <EmptyState icon={<Users />} title="Nobody picked yet" text="Choose who gets it, then find recipients." />
        )}
        {recipients !== null && (
          <>
            <div>
              <small className="ink3">Will be sent to</small>
              <div className="big num" aria-live="polite">{countText(count)}</div>
              <small className="ink3">Customers who opted out of {channel === 'sms' ? 'SMS' : 'WhatsApp'} are left out.</small>
            </div>
            {count > 0 && (
              <Table
                label="Recipients" rowKey={(r) => r.id} rows={recipients.slice(0, SHOWN)}
                columns={[
                  { key: 'name', header: 'Name', render: (r) => `${r.firstName} ${r.lastName}`.trim() },
                  { key: 'phone', header: 'Phone', render: (r) => r.phoneNumber },
                ]}
              />
            )}
            {count > SHOWN && <p className="hint">and {countText(count - SHOWN)} more</p>}
            <div className="sendrow">
              <Button variant="primary" disabled={!ready || count === 0 || sending} onClick={() => setConfirm(true)}><Send style={{ width: 15, height: 15 }} />Send now</Button>
              {!ready && <span className="hint">{channel === 'sms' ? 'Write the text first.' : 'Pick a template first.'}</span>}
            </div>
          </>
        )}
        {result && (
          <div role="status">
            <small className="ink3">Last send</small>
            <div className="lines">
              <div><span>Sent</span><b>{countText(sentCount)}</b></div>
              <div><span>Skipped (opted out or not sendable)</span><b>{countText(result.skipped)}</b></div>
              <div><span>Failed</span><b>{countText(failedCount)}</b></div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void send()} action="Send" count={count} noun="message" title={`Send ${countText(count)} ${channel === 'sms' ? 'SMS' : 'WhatsApp'} ${count === 1 ? 'message' : 'messages'}?`}>
        Customers who opted out are skipped. You cannot undo a send.
      </ConfirmDialog>
    </div>
  );
}
