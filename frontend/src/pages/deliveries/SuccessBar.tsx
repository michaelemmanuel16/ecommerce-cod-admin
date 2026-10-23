import { Tag } from '../../components/ui-v2';
import type { RateResult } from '../../services/delivery-partners.service';
import { rateTone, wholePercent } from './model';

/** The success cell: the figure, and a bar with the target line. No closed order shows the sentence instead (F-702). */
export function SuccessBar({ rate, target }: { rate: RateResult; target: number }) {
  const text = wholePercent(rate);
  if (text === null || rate.value === null) return <Tag>No closed orders yet</Tag>;
  return (
    <div className="rate">
      <b className="num">{text}</b>
      <div className="prog" role="img" aria-label={`${text} delivery success, target ${target}%`}>
        <i className={rateTone(rate.value, target)} style={{ width: `${Math.min(100, Math.round(rate.value))}%` }} />
        <span className="pace" style={{ left: `${target}%` }} />
      </div>
    </div>
  );
}
