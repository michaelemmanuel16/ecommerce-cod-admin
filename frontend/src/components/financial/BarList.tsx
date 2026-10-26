import type { ReactNode } from 'react';

export interface BarRow {
  key: string;
  label: ReactNode;
  /** A second line under the label (the order count). */
  sub?: ReactNode;
  value: ReactNode;
  /** Bar length, 0 to 100. */
  width: number;
  color: string;
  /** With `onClick` the row is a button; `on` marks the picked one. */
  on?: boolean;
  onClick?: () => void;
}

interface BarListProps {
  rows: BarRow[];
  label: string;
  /** The wider label column of the Expenses "By category" bars. */
  wide?: boolean;
}

/** A list of bars (finance.html .bars .bar-row): label, track and value in a row; the grid columns are in CSS. */
export function BarList({ rows, label, wide }: BarListProps) {
  const clickable = rows.some((r) => r.onClick);
  return (
    <div className={wide ? 'bars wide' : 'bars'} role={clickable ? undefined : 'list'} aria-label={clickable ? undefined : label}>
      {rows.map((r) => {
        const inner = (
          <>
            <span>{r.label}{r.sub && <small className="sub">{r.sub}</small>}</span>
            <div className="track"><i style={{ width: `${r.width}%`, background: r.color }} /></div>
            <span className="val num">{r.value}</span>
          </>
        );
        return r.onClick ? (
          <button key={r.key} type="button" className={`bar-row${r.on ? ' on' : ''}`} aria-pressed={r.on} onClick={r.onClick}>{inner}</button>
        ) : (
          <div key={r.key} className="bar-row" role={clickable ? undefined : 'listitem'}>{inner}</div>
        );
      })}
    </div>
  );
}
