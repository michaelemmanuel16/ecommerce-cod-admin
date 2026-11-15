import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCheck, CornerUpLeft, Eye, Send } from 'lucide-react';
import { BlockError } from '../dashboard/blocks/Frame';
import { Select, Skeleton, Tile, type TagTone, type TileTone } from '../../components/ui-v2';
import { messagesService } from '../../services/messages.service';
import { rangeLabel } from '../reports/format';
import { CHANNEL_LABEL, countText, rateText } from './format';
import { datesFor, RANGES, type RangeKey } from './range';
import { useLoad } from './useLoad';
import type { Channel, Figures, LogStatus } from './types';

interface TileDef {
  figure: Exclude<LogStatus, 'pending'>;
  label: string;
  icon: typeof Send;
  tone: TileTone;
  /** The rate the API gives for this figure, with its words. */
  rate?: { key: keyof Figures; text: string; tag: TagTone };
}

const TILES: TileDef[] = [
  { figure: 'sent', label: 'Sent', icon: Send, tone: 'pine' },
  { figure: 'delivered', label: 'Delivered', icon: CheckCheck, tone: 'mint', rate: { key: 'deliveredRate', text: 'of sent', tag: 'ok' } },
  { figure: 'read', label: 'Read', icon: Eye, tone: 'mint', rate: { key: 'readRate', text: 'of sent', tag: 'ok' } },
  { figure: 'replied', label: 'Replied', icon: CornerUpLeft, tone: 'violet', rate: { key: 'replyRate', text: 'of sent', tag: 'v' } },
  { figure: 'failed', label: 'Failed', icon: AlertCircle, tone: 'coral', rate: { key: 'failedRate', text: 'of sent', tag: 'bad' } },
];

interface Props {
  /** Open the log filtered by this figure, range and channel: its rows are what the tile counts. */
  logHref: (figure: TileDef['figure'], range: RangeKey, channel: Channel | '') => string;
}

/** The tiles of GET /api/messages/overview. The page does no arithmetic: counts and rates come from the API. */
export function OverviewTab({ logHref }: Props) {
  const [range, setRange] = useState<RangeKey>('month');
  const [channel, setChannel] = useState<Channel | ''>('');
  const dates = datesFor(range) as { from: string; to: string };
  const data = useLoad(() => messagesService.overview({ ...dates, ...(channel && { channel }) }), `${range}|${channel}`);
  const f = data.data?.total;

  return (
    <div role="tabpanel" aria-label="Overview" className={data.loading && f ? 'busy' : undefined}>
      <div className="card datecard">
        <div className="seg" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.id} type="button" className={r.id === range ? 'on' : undefined} aria-pressed={r.id === range} onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>
        <Select compact label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}>
          <option value="">All channels</option>
          {(['whatsapp', 'sms', 'email'] as const).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
        </Select>
        <div className="rangetext"><b>{rangeLabel(dates.from, dates.to)}</b></div>
      </div>

      {data.failed && !f ? (
        <BlockError name="Message figures" onRetry={() => void data.reload()} />
      ) : !f ? (
        <div className="grid kpis" aria-busy="true">{TILES.map((t) => <Skeleton key={t.figure} height={130} className="skelcard" />)}</div>
      ) : (
        <div className="grid kpis k5">
          {TILES.map((t) => {
            const rate = t.rate ? f[t.rate.key] as number | null : undefined;
            return (
              <Tile
                key={t.figure} tone={t.tone} icon={<t.icon />} value={countText(f[t.figure])} label={t.label}
                footer={(
                  <>
                    <span>{t.rate ? <>{rateText(rate)} {t.rate.text}</> : 'Left the system'}</span>
                    <Link className="lnk" to={logHref(t.figure, range, channel)} aria-label={`Show ${t.label.toLowerCase()} messages in the log`}>Show in log</Link>
                  </>
                )}
              />
            );
          })}
        </div>
      )}
      {f && f.skipped > 0 && (
        <p className="hint">{countText(f.skipped)} {f.skipped === 1 ? 'message was' : 'messages were'} not sent (opted out or no number). They are in no tile above.</p>
      )}
    </div>
  );
}
