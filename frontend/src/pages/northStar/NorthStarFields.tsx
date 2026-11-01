import { Button, Input } from '../../components/ui-v2';
import { getCurrencySymbol } from '../../utils/countries';
import { compactMoney } from '../dashboard/format';
import { formatCount } from '../targets/model';
import { MODES, PAST_MONTHS_NOTE, calculatorLine, customGapText, perMonth } from './model';
import type { NorthStarDraft } from './useNorthStarDraft';

interface Props {
  draft: NorthStarDraft;
  /** The person may type here; false shows the same fields read only (Settings tab for a non-Owner). */
  editable: boolean;
  /** 'four' also shows the two rates as read-only tiles (Settings tab). */
  tiles?: 'two' | 'four';
}

/**
 * The inputs and the live tiles of the North Star (F-1111 to F-1113): annual figure, growth mode, the four quarter tiles (typed in
 * Custom, with the gap in red), the three drivers, the planned average order with its reset, and the calculator tiles. The wizard
 * (step 3) and the Settings tab both draw this.
 */
export function NorthStarFields({ draft: d, editable, tiles = 'two' }: Props) {
  const symbol = getCurrencySymbol(d.currency);
  const gapText = customGapText(d.gap, d.currency);
  const aovHint = d.aovSource === 'manual'
    ? 'Your own figure.'
    : d.last30Days === null ? 'No orders were delivered in the last 30 days: type your planned average order.' : 'Last 30 days of delivered orders (automatic).';

  return (
    <div className="nsf">
      <div className="fl">
        <label htmlFor="ns-annual">Annual North Star (delivered revenue)</label>
        <div className="nsmoney"><span>{symbol}</span><input id="ns-annual" inputMode="numeric" value={d.annual} disabled={!editable} onChange={(e) => d.setAnnual(e.target.value)} /></div>
        {d.setOn && <div className="hint">Set on {new Date(`${d.setOn}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>}
      </div>

      <div className="nsmode">
        <span className="nslabel" id="ns-mode-label">How should it grow?</span>
        <div className="seg" role="group" aria-labelledby="ns-mode-label">
          {MODES.map((m) => (
            <button key={m.key} type="button" className={d.mode === m.key ? 'on' : ''} aria-pressed={d.mode === m.key} disabled={!editable} onClick={() => d.setMode(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>

      <div className="nssplit" aria-label="Quarters">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="nsq">
            <h4>Q{i + 1}</h4>
            {d.mode === 'custom' ? (
              <input aria-label={`Q${i + 1} amount`} inputMode="numeric" value={d.custom[i]} disabled={!editable} onChange={(e) => d.setCustom(i, e.target.value)} />
            ) : (
              <b className="num">{d.preview ? compactMoney(d.preview.quarters[i], d.currency) : '…'}</b>
            )}
            <small>{d.preview ? perMonth(d.preview.months[i], d.currency) : ''}</small>
          </div>
        ))}
      </div>
      {gapText && <p className="nsgap" role="alert">{gapText}</p>}
      {d.pastMonths && <p className="nsnote" role="note">{PAST_MONTHS_NOTE}</p>}

      <div className="nsdrivers">
        <div className="fl">
          <label htmlFor="ns-aov">Planned average order</label>
          <div className="nsmoney"><span>{symbol}</span><input id="ns-aov" inputMode="numeric" value={d.aov} disabled={!editable} onChange={(e) => d.setAov(e.target.value)} /></div>
          <div className="hint">
            {aovHint}{' '}
            {editable && d.aovSource === 'manual' && d.last30Days !== null && <Button size="mini" onClick={d.resetAov}>Reset to last 30 days</Button>}
          </div>
        </div>
        <Input label="Confirmation rate target (%)" inputMode="numeric" value={d.confirmation} disabled={!editable} onChange={(e) => d.setConfirmation(e.target.value)} />
        <Input label="Delivery success target (%)" inputMode="numeric" value={d.success} disabled={!editable} onChange={(e) => d.setSuccess(e.target.value)} />
        <Input label="Net margin target (%)" inputMode="numeric" value={d.margin} disabled={!editable} onChange={(e) => d.setMargin(e.target.value)} />
      </div>

      <div className="nstiles" aria-live="polite">
        <div className="drv"><small>Orders a day you need</small><b className="num">{d.calc ? formatCount(d.calc.ordersPerDay) : '—'}</b></div>
        {tiles === 'four' && <div className="drv"><small>Confirmation rate</small><b className="num">{d.confirmation}%</b></div>}
        {tiles === 'four' && <div className="drv"><small>Delivery success rate</small><b className="num">{d.success}%</b></div>}
        <div className="drv"><small>Max cost per order</small><b className="num">{d.calc?.maxCostPerOrder != null ? compactMoney(d.calc.maxCostPerOrder, d.currency) : '—'}</b></div>
      </div>
      {d.calc && <p className="nsmath">{calculatorLine(d.calc, d.currency)}</p>}
      {d.calcError && <p className="nsgap" role="alert">{d.calcError}</p>}
    </div>
  );
}
