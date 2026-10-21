import type { ReactNode } from 'react';
import clsx from 'clsx';

export type TileTone = 'pine' | 'mint' | 'coral' | 'gold' | 'violet';

interface TileProps {
  /** A lucide icon element, for example <ShoppingCart />. */
  icon?: ReactNode;
  tone?: TileTone;
  value: ReactNode;
  label: ReactNode;
  /** Bottom row (.kpi .s): target text on the left, a Tag on the right. */
  footer?: ReactNode;
  className?: string;
}

/** A KPI tile: .card.kpi with icon, value, label and footer row. */
export function Tile({ icon, tone = 'pine', value, label, footer, className }: TileProps) {
  return (
    <div className={clsx('card kpi', className)}>
      {icon && <div className={clsx('ic', tone)}>{icon}</div>}
      <div className="v num">{value}</div>
      <div className="l">{label}</div>
      {footer && <div className="s">{footer}</div>}
    </div>
  );
}
