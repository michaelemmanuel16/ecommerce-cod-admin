import { useEffect, useState } from 'react';
import { FileText, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { BlockError } from '../dashboard/blocks/Frame';
import { Button, ConfirmDialog, EmptyState, Select, Skeleton, Tag, useToast } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { apiMessage } from '../orders/importText';
import { CHANNEL_LABEL } from './format';
import { TemplateModal } from './TemplateModal';
import { STATUS_TEXT } from './templateModel';
import { useLoad } from './useLoad';
import type { Channel, MessageTemplate } from './types';

const CHANNEL_TONE = { whatsapp: 'ok', sms: 'n', email: 'v' } as const;

/**
 * Templates (M9-T34): SMS, WhatsApp and email templates in one list, from /api/message-templates. A WhatsApp template shows
 * the status Meta gave it. Owner and admin change them (the API checks); everyone else who opens the tab only reads.
 */
export function TemplatesTab({ canWrite }: { canWrite: boolean }) {
  const say = useToast();
  const [channel, setChannel] = useState<Channel | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<MessageTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const data = useLoad(() => messagesService.listTemplates({ ...(channel && { channel }), ...(q && { q }) }), `${channel}|${q}`);
  const filtered = !!(channel || q);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await messagesService.syncTemplates();
      say(`Synced from Meta: ${r.created} new, ${r.updated} updated`);
      void data.reload();
    } catch (err) {
      say(await apiMessage(err, 'The sync did not work'));
    } finally {
      setSyncing(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const gone = deleting;
    try {
      await messagesService.deleteTemplate(gone.id);
      setDeleting(null);
      say(`${gone.name} deleted`);
      void data.reload();
    } catch (err) {
      setDeleting(null);
      say(await apiMessage(err, 'The template was not deleted'));
    }
  };

  return (
    <div role="tabpanel" aria-label="Templates" className={data.loading && data.data ? 'busy' : undefined}>
      <div className="bar2">
        <label className="srch">
          <Search />
          <input type="search" aria-label="Search templates" placeholder="Search templates" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select compact label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}>
          <option value="">All channels</option>
          {(['whatsapp', 'sms', 'email'] as const).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </Select>
        {canWrite && (
          <span className="rt">
            <Button onClick={() => void sync()} disabled={syncing}><RefreshCw style={{ width: 15, height: 15 }} />{syncing ? 'Syncing' : 'Sync from Meta'}</Button>
            <Button variant="primary" onClick={() => setEditing('new')}><Plus style={{ width: 15, height: 15 }} />New template</Button>
          </span>
        )}
      </div>

      {data.failed && !data.data ? (
        <div className="pad"><BlockError bare name="Templates" onRetry={() => void data.reload()} /></div>
      ) : !data.data ? (
        <div className="pad" aria-busy="true"><Skeleton height={200} /></div>
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={<FileText />} title={filtered ? 'No template matches these filters' : 'No templates yet'}
          text={filtered ? 'Change a filter to see more.' : canWrite ? 'Save the messages you send again and again.' : 'Templates your team saves show here.'}
        />
      ) : (
        <div className="tgrid">
          {data.data.map((t) => {
            const st = t.channel === 'whatsapp' ? STATUS_TEXT[t.status ?? ''] ?? { label: 'Not synced', tone: 'n' as const } : null;
            return (
              <div className="tpl" key={t.id}>
                <div className="tt">
                  <b>{t.name}</b>
                  <span className="tg2">
                    <Tag tone={CHANNEL_TONE[t.channel]}>{CHANNEL_LABEL[t.channel]}</Tag>
                    {st && <Tag tone={st.tone}>{st.label}</Tag>}
                  </span>
                </div>
                {t.subject && <small className="ink3">Subject: {t.subject}</small>}
                <p>{t.channel === 'email' ? t.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : t.body}</p>
                {t.status === 'rejected' && t.rejectReason && <small className="failnote2">Meta said: {t.rejectReason}</small>}
                {canWrite && (
                  <div className="acts">
                    <Button size="mini" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil style={{ width: 13, height: 13 }} /> Edit</Button>
                    <Button size="mini" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)}><Trash2 style={{ width: 13, height: 13 }} /> Delete</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <TemplateModal
          open template={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void data.reload(); }}
        />
      )}
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => void remove()} action="Delete" count={1} noun="template" title={`Delete ${deleting?.name ?? 'template'}?`}>
        It is removed for everyone on your team. You cannot undo this.
      </ConfirmDialog>
    </div>
  );
}
