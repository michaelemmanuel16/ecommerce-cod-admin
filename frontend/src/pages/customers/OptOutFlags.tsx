import { Tag } from '../../components/ui-v2';

export type OptOutChannel = 'sms' | 'whatsapp' | 'email';

const ROWS: Array<{ channel: OptOutChannel; label: string; flag: 'smsOptOut' | 'whatsappOptOut' | 'emailOptOut' }> = [
  { channel: 'sms', label: 'SMS', flag: 'smsOptOut' },
  { channel: 'whatsapp', label: 'WhatsApp', flag: 'whatsappOptOut' },
  { channel: 'email', label: 'Email messages', flag: 'emailOptOut' },
];

interface Props {
  flags: { smsOptOut: boolean; whatsappOptOut: boolean; emailOptOut: boolean };
  /** Staff with customers:update get a switch for each channel; anyone else reads a tag. */
  canEdit: boolean;
  busy: OptOutChannel | null;
  onToggle: (channel: OptOutChannel, optedOut: boolean) => void;
}

/** The opt-out flags of one customer, as the rows of the Contact card (M9-T35, F-360). A switch on means opted out. */
export function OptOutFlags({ flags, canEdit, busy, onToggle }: Props) {
  return (
    <>
      {ROWS.map(({ channel, label, flag }) => {
        const off = flags[flag];
        return (
          <div className="optrow" key={channel}>
            <dt>{label}</dt>
            <dd>
              {canEdit ? (
                <span className="optsw">
                  <button
                    type="button" role="switch" className="sw" aria-checked={off} aria-label={`${label} opt-out`} disabled={busy === channel}
                    onClick={() => onToggle(channel, !off)}
                  />
                  <span>{off ? 'Opted out' : 'Receives'}</span>
                </span>
              ) : off ? <Tag tone="warn">Opted out</Tag> : <Tag tone="ok">Receives</Tag>}
            </dd>
          </div>
        );
      })}
    </>
  );
}
