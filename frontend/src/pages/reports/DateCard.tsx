import { PRESETS, type DayRange, type Preset } from './range';

interface DateCardProps {
  preset: Preset;
  /** The days asked for (the custom fields show these). */
  range: DayRange;
  onPreset: (preset: Preset) => void;
  onCustom: (range: DayRange) => void;
  compare: boolean;
  onCompare: (on: boolean) => void;
  /** "1-17 Oct 2026" and "Previous period: 1-17 Sep 2026". The second is null while compare is off or not answered yet. */
  label: string;
  compareLabel: string | null;
}

/** Date presets, custom dates and the "Compare to previous period" switch (F-1050, mockup date card). */
export function DateCard({ preset, range, onPreset, onCustom, compare, onCompare, label, compareLabel }: DateCardProps) {
  return (
    <div className="card datecard">
      <div className="seg" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={p.id === preset ? 'on' : undefined} aria-pressed={p.id === preset} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="customdates">
          <input type="date" className="psel" aria-label="From date" value={range.from} max={range.to} onChange={(e) => e.target.value && onCustom({ from: e.target.value, to: range.to })} />
          <span className="ink3">to</span>
          <input type="date" className="psel" aria-label="To date" value={range.to} min={range.from} onChange={(e) => e.target.value && onCustom({ from: range.from, to: e.target.value })} />
        </div>
      )}
      <label className="sw">
        <input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />
        <span className="tg" />
        Compare to previous period
      </label>
      <div className="rangetext">
        <b>{label}</b>
        {compareLabel && <div className="ink3">{compareLabel}</div>}
      </div>
    </div>
  );
}
