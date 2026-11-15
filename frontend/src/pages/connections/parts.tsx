import type { MouseEvent, ReactNode } from 'react';
import { AlertCircle, ChevronRight, Copy, type LucideIcon } from 'lucide-react';
import { Button, Card, Modal, Tag, useToast } from '../../components/ui-v2';
import type { ConnectionCard } from '../../services/connections.service';

type Tone = 'mint' | 'violet' | 'pine' | 'plain';
const ICON_STYLE: Record<Tone, { background: string; color: string }> = {
  mint: { background: 'var(--mint-soft)', color: 'var(--ok-ink)' },
  violet: { background: 'var(--violet-soft)', color: 'var(--violet)' },
  pine: { background: 'var(--pine-soft)', color: 'var(--pine)' },
  plain: { background: 'var(--hover)', color: 'var(--ink-2)' },
};

/** The status pill of a card: from the API status; a card that is on but in test mode can say so. */
function StatusTag({ card, testMode }: { card: ConnectionCard; testMode?: boolean }) {
  if (card.status === 'error') return <Tag tone="bad">Needs attention</Tag>;
  if (card.status === 'not_connected') return <Tag>Not connected</Tag>;
  return testMode ? <Tag tone="warn">Test mode</Tag> : <Tag tone="ok">Connected</Tag>;
}

/** A copy button that says so in a toast. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const say = useToast();
  const copy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      say('Copied');
    } catch {
      say('Could not copy. Select the text and copy it by hand.');
    }
  };
  return (
    <button type="button" className="copy" onClick={copy}>
      <Copy aria-hidden="true" />{label}
    </button>
  );
}

interface ConnCardProps {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  sub: string;
  card: ConnectionCard;
  testMode?: boolean;
  /** The two key facts at most; the modal holds the rest. */
  rows?: Array<[string, ReactNode]>;
  /** Opens the card's modal (the whole card is the button). */
  onOpen: () => void;
}

/** One connection card (docs/mockups/v2/connections.html .cn), a short summary. The whole card is a button that opens its modal. */
export function ConnCard({ icon: Icon, tone, title, sub, card, testMode, rows, onOpen }: ConnCardProps) {
  return (
    <Card
      className="cn clickable" data-testid={`card-${title}`} role="button" tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
    >
      <div className="cn-top">
        <div className="ic" style={ICON_STYLE[tone]}><Icon aria-hidden="true" /></div>
        <div><b>{title}</b><p>{sub}</p></div>
        <StatusTag card={card} testMode={testMode} />
      </div>
      {card.status === 'not_connected' && card.reason && <p className="cn-off">{card.reason}</p>}
      {rows && rows.length > 0 && (
        <dl className="kv">
          {rows.slice(0, 2).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
      <span className="manage">Manage <ChevronRight aria-hidden="true" /></span>
    </Card>
  );
}

interface ConnDetailProps extends Pick<ConnCardProps, 'icon' | 'tone' | 'title' | 'sub' | 'card' | 'testMode'> {
  open: boolean;
  onClose: () => void;
  /** Every fact of the connection. */
  rows?: Array<[string, ReactNode]>;
  /** The Retry in an error card. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Extra body (a URL line, the Meta account list). */
  children?: ReactNode;
  /** The buttons. Null when the person may only read. */
  actions: ReactNode;
  /** The one line shown in place of the buttons for a reader. */
  readOnlyText?: string;
}

/** The modal of a connection card: the details and every action, or one line for a person who may only read. */
export function ConnDetail({ open, onClose, icon: Icon, tone, title, sub, card, testMode, rows, onRetry, retrying, children, actions, readOnlyText = 'Only the owner or an admin can change this.' }: ConnDetailProps) {
  return (
    <Modal
      open={open} onClose={onClose} size="lg"
      title={<span className="cxd-title"><span className="ic" style={ICON_STYLE[tone]}><Icon aria-hidden="true" /></span>{title}</span>}
      description={sub}
    >
      <div className="cxd stack cx-detail">
        <div><StatusTag card={card} testMode={testMode} /></div>
        {card.status === 'not_connected' && card.reason && <p className="cn-off">{card.reason}</p>}
        {rows && rows.length > 0 && (
          <dl className="kv">
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        )}
        {card.status === 'error' && (
          <div className="strip bad" role="alert">
            <AlertCircle aria-hidden="true" /><span>{card.reason ?? 'This connection has a problem.'}</span>
          </div>
        )}
        {children}
        <div className="acts">
          {actions ?? <p className="cn-off">{readOnlyText}</p>}
          {card.status === 'error' && onRetry && (
            <Button onClick={onRetry} disabled={retrying}>{retrying ? 'Checking...' : 'Retry'}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
