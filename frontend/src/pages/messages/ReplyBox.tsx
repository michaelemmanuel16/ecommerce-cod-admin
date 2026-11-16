import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Select, useToast } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { apiMessage } from '../orders/importText';
import type { ReplyTemplate } from './types';

interface Props {
  conversationId: number;
  windowOpen: boolean;
  onSent: () => void;
  /** Sends the message. Left out: a reply to `conversationId`. The rep app passes one that starts a thread from an order. */
  /** Set: the box is shown disabled with this hint (the rep app, WhatsApp not connected). */
  disabledHint?: string;
  send?: (payload: { body: string } | { templateId: number; variables: string[] }) => Promise<void>;
}

/**
 * The reply box of a WhatsApp thread. With the 24 hour window open it sends free text; once it is closed the API
 * allows only an approved template, so the box says so and offers those (F-454).
 */
export function ReplyBox({ conversationId, windowOpen, onSent, send: sendFn, disabledHint }: Props) {
  const say = useToast();
  const [text, setText] = useState('');
  const [templates, setTemplates] = useState<ReplyTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => { setText(''); setTemplateId(''); setValues([]); }, [conversationId]);

  useEffect(() => {
    if (windowOpen) return;
    let live = true;
    messagesService.approvedTemplates().then((t) => { if (live) setTemplates(t); }, () => { if (live) setTemplates([]); });
    return () => { live = false; };
  }, [windowOpen, conversationId]);

  const template = templates?.find((t) => String(t.id) === templateId) ?? null;
  const pick = (id: string) => {
    setTemplateId(id);
    const t = templates?.find((x) => String(x.id) === id);
    setValues(t ? t.variables.map(() => '') : []);
  };

  const send = async () => {
    setSending(true);
    try {
      const payload = windowOpen ? { body: text.trim() } : { templateId: template!.id, variables: values.map((v) => v.trim()) };
      await (sendFn ? sendFn(payload) : messagesService.reply(conversationId, payload));
      say('Reply sent');
      setText('');
      setTemplateId('');
      setValues([]);
      onSent();
    } catch (err) {
      say(await apiMessage(err, 'The reply was not sent'));
    } finally {
      setSending(false);
    }
  };

  if (disabledHint) {
    return (
      <div className="compose" aria-disabled="true">
        <div className="row">
          <textarea className="msgin" aria-label="Reply" rows={2} placeholder="Write a reply" disabled />
          <button type="button" className="send" aria-label="Send reply" disabled><Send /></button>
        </div>
        <p className="hint" role="status">{disabledHint}</p>
      </div>
    );
  }

  if (windowOpen) {
    const ready = text.trim().length > 0 && !sending;
    return (
      <form className="compose" onSubmit={(e) => { e.preventDefault(); if (ready) void send(); }}>
        <div className="row">
          <textarea className="msgin" aria-label="Reply" rows={2} maxLength={4096} placeholder="Write a reply" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="send" aria-label="Send reply" disabled={!ready}><Send /></button>
        </div>
      </form>
    );
  }

  const filled = !!template && values.every((v) => v.trim().length > 0);
  return (
    <div className="compose">
      <p className="winclosed" role="status">The 24 hour window is closed. Send an approved template.</p>
      {templates === null ? null : templates.length === 0 ? (
        <p className="hint">No approved WhatsApp template yet. Approve one in Meta, then sync templates.</p>
      ) : (
        <>
          <Select label="Template" compact value={templateId} onChange={(e) => pick(e.target.value)}>
            <option value="">Pick an approved template</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          {template && (
            <>
              <p className="tplbody">{template.body}</p>
              {template.variables.map((name, i) => (
                <input
                  key={`${template.id}-${i}`} className="tcell" aria-label={`Value for ${name}`} placeholder={name}
                  value={values[i] ?? ''} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                />
              ))}
            </>
          )}
          <div className="row end"><Button variant="primary" disabled={!filled || sending} onClick={() => void send()}><Send style={{ width: 15, height: 15 }} />Send template</Button></div>
        </>
      )}
    </div>
  );
}
