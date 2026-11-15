import type { ReactNode } from 'react';
import { AlertCircle, Copy, type LucideIcon } from 'lucide-react';
import { Button, Card, Tag, useToast } from '../../components/ui-v2';
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
  const copy = async () => {
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
  /** Replaces the status pill (the CSV card is always "Manual"). */
  tag?: ReactNode;
  rows?: Array<[string, ReactNode]>;
  /** The Retry in an error card. */
  onRetry?: () => void;
  retrying?: boolean;
  children?: ReactNode;
  className?: string;
}

/** One connection card (docs/mockups/v2/connections.html .cn): icon, name, status, facts, the API's reason, buttons. */
export function ConnCard({ icon: Icon, tone, title, sub, card, testMode, tag, rows, onRetry, retrying, children, className }: ConnCardProps) {
  return (
    <Card className={`cn ${className ?? ''}`} data-testid={`card-${title}`}>
      <div className="cn-top">
        <div className="ic" style={ICON_STYLE[tone]}><Icon aria-hidden="true" /></div>
        <div><b>{title}</b><p>{sub}</p></div>
        {tag ?? <StatusTag card={card} testMode={testMode} />}
      </div>
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
      <div className="acts">
        {children}
        {card.status === 'error' && onRetry && (
          <Button onClick={onRetry} disabled={retrying}>{retrying ? 'Checking...' : 'Retry'}</Button>
        )}
      </div>
    </Card>
  );
}
