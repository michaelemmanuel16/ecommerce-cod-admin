import { useRef, useState } from 'react';
import { Button, Input, Modal, Select, useToast } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { apiMessage } from '../orders/importText';
import { CHANNEL_LABEL } from './format';
import { BODY_LIMIT, MERGE_TAGS, nextVariable, previewText } from './templateModel';
import type { Channel, MessageTemplate, TemplateInput } from './types';

const CATEGORIES = [['UTILITY', 'Utility'], ['MARKETING', 'Marketing'], ['AUTHENTICATION', 'Authentication']] as const;

interface Props {
  /** The template being edited, or null for a new one. */
  template: MessageTemplate | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Create or edit one template. The channel is chosen once: it never changes after save (the API refuses it). */
export function TemplateModal({ template, open, onClose, onSaved }: Props) {
  const say = useToast();
  const editing = template !== null;
  const [channel, setChannel] = useState<Channel>(template?.channel ?? 'sms');
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [language, setLanguage] = useState(template?.language ?? 'en_US');
  const [category, setCategory] = useState(template?.category ?? 'UTILITY');
  const [metaName, setMetaName] = useState(template?.metaTemplateName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const limit = BODY_LIMIT[channel];
  const over = body.length > limit;

  // Put the chip's text where the cursor is
  const insert = (text: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? start;
    setBody(body.slice(0, start) + text + body.slice(end));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + text.length, start + text.length); });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const fields: TemplateInput = { name: name.trim(), body: body.trim() };
    if (channel === 'email') fields.subject = subject.trim();
    if (channel === 'whatsapp') Object.assign(fields, { language: language.trim(), category, ...(metaName.trim() && { metaTemplateName: metaName.trim() }) });
    try {
      if (template) await messagesService.updateTemplate(template.id, fields);
      else await messagesService.createTemplate({ ...fields, channel, name: fields.name!, body: fields.body! });
      say(`${name.trim()} saved`);
      onSaved();
    } catch (err) {
      setError(await apiMessage(err, 'The template was not saved'));
    } finally {
      setSaving(false);
    }
  };

  const previewBody = previewText(channel, body);
  const previewHtml = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui,sans-serif;margin:12px;color:#1f2937">${previewText('email', body)}`;

  return (
    <Modal
      open={open} onClose={onClose} size="lg" title={editing ? 'Edit template' : 'New template'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || !name.trim() || !body.trim() || over || (channel === 'email' && !subject.trim())} onClick={() => void save()}>{saving ? 'Saving' : 'Save template'}</Button></>}
    >
      <div className="tplform">
        <div>
          {!editing && (
            <div className="fld">
              <span className="lab" id="tpl-ch">Channel</span>
              <div className="seg" role="group" aria-labelledby="tpl-ch">
                {(['sms', 'whatsapp', 'email'] as const).map((c) => (
                  <button key={c} type="button" className={channel === c ? 'on' : undefined} aria-pressed={channel === c} onClick={() => setChannel(c)}>{CHANNEL_LABEL[c]}</button>
                ))}
              </div>
            </div>
          )}
          <div className="fld"><Input label="Template name" placeholder="e.g. Order confirmation" value={name} onChange={(e) => setName(e.target.value)} /></div>
          {channel === 'email' && <div className="fld"><Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>}
          <div className="fld fl">
            <label htmlFor="tpl-body">{channel === 'email' ? 'Message (simple HTML allowed)' : 'Message'}</label>
            <textarea id="tpl-body" ref={area} rows={channel === 'email' ? 9 : 6} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className={over ? 'err' : 'hint'}>{body.length.toLocaleString('en-US')} of {limit.toLocaleString('en-US')} characters</p>
          </div>

          {channel === 'email' && (
            <div className="tags" role="group" aria-label="Insert a merge tag">
              <span className="ink3">Insert</span>
              {MERGE_TAGS.map((t) => <button key={t.tag} type="button" onClick={() => insert(`{{${t.tag}}}`)}>{t.label}</button>)}
            </div>
          )}
          {channel === 'whatsapp' && (
            <div className="tags" role="group" aria-label="Insert a variable">
              <span className="ink3">Insert</span>
              <button type="button" onClick={() => insert(`{{${nextVariable(body)}}}`)}>Next variable</button>
              <span className="ink3">Meta fills {'{{1}}'}, {'{{2}}'} and so on when the message is sent.</span>
            </div>
          )}
          {channel === 'sms' && <p className="hint">SMS goes out exactly as you write it. No merge tags are filled in.</p>}

          {channel === 'whatsapp' && (
            <div className="fld two2" style={{ marginTop: 16 }}>
              <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Input label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} />
              <Input label="Name on Meta" optional value={metaName} placeholder={name || 'Same as the name'} onChange={(e) => setMetaName(e.target.value)} />
            </div>
          )}
          {channel === 'whatsapp' && <p className="hint">WhatsApp approves templates, not us. Make the template in Meta, then use Sync from Meta to bring in its status.</p>}
          {error && <p className="err" role="alert">{error}</p>}
        </div>

        <div className="tplprev" aria-label="Preview">
          <span className="lab">Preview with sample data</span>
          {channel === 'email' ? (
            <>
              <b className="sub">{previewText('email', subject) || 'No subject yet'}</b>
              <iframe title="Email preview" sandbox="" srcDoc={previewHtml} />
            </>
          ) : (
            <div className="bub" data-testid="preview-bubble">{previewBody || 'Your message shows here.'}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
