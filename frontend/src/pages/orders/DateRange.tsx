import { useEffect, useState } from 'react';
import { Calendar, Check, ChevronDown } from 'lucide-react';
import { usePopover } from '../../components/shell/usePopover';
import { PRESET_LABELS, presetOf, presetRange, type DateBasis, type RangePreset } from './urlState';

interface DateRangeProps {
  range: { from: string; to: string };
  basis: DateBasis;
  onRange: (range: { from: string; to: string }) => void;
  onBasis: (basis: DateBasis) => void;
}

const PRESETS: Array<Exclude<RangePreset, 'custom'>> = ['today', 'yesterday', 'last7', 'month', 'lastMonth'];

/** F-311: a range button with a menu (Today to Last month, Custom) and the Order date | Delivery date switch. */
export function DateRange({ range, basis, onRange, onBasis }: DateRangeProps) {
  const menu = usePopover();
  const preset = presetOf(range);
  // The two date fields show for a custom range, or after "Custom" is chosen.
  const [custom, setCustom] = useState(preset === 'custom');
  useEffect(() => {
    if (preset === 'custom') setCustom(true);
  }, [preset]);
  return (
    <>
      <div className="mwrap" ref={menu.wrapRef}>
        <button
          ref={menu.triggerRef}
          type="button"
          className="btn"
          aria-haspopup="menu"
          aria-expanded={menu.open}
          aria-label={`Date range: ${PRESET_LABELS[preset]}`}
          onClick={menu.toggle}
        >
          <Calendar />
          {PRESET_LABELS[preset]}
          <ChevronDown style={{ width: 15, height: 15 }} />
        </button>
        {menu.open && (
          <div className="menu left" role="menu" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="menuitemradio"
                aria-checked={!custom && preset === p}
                onClick={() => {
                  setCustom(false);
                  onRange(presetRange(p));
                  menu.close();
                }}
              >
                {PRESET_LABELS[p]}
                {!custom && preset === p && <Check className="cur" aria-hidden="true" />}
              </button>
            ))}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={custom}
              onClick={() => {
                setCustom(true);
                menu.close();
              }}
            >
              {PRESET_LABELS.custom}
              {custom && <Check className="cur" aria-hidden="true" />}
            </button>
          </div>
        )}
      </div>
      {custom && (
        <>
          <input
            type="date"
            className="datein"
            aria-label="From date"
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && onRange({ from: e.target.value, to: range.to })}
          />
          <input
            type="date"
            className="datein"
            aria-label="To date"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && onRange({ from: range.from, to: e.target.value })}
          />
        </>
      )}
      <div className="seg" role="group" aria-label="Date basis">
        <button type="button" className={basis === 'created' ? 'on' : undefined} aria-pressed={basis === 'created'} onClick={() => onBasis('created')}>
          Order date
        </button>
        <button type="button" className={basis === 'delivery' ? 'on' : undefined} aria-pressed={basis === 'delivery'} onClick={() => onBasis('delivery')}>
          Delivery date
        </button>
      </div>
    </>
  );
}
