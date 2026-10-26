import type { CSSProperties } from 'react';
import { Skeleton } from '../../components/ui-v2';

/** A few grey bars while a list loads. */
export function ListSkeleton({ label, rows = 2, height = 56, style }: { label: string; rows?: number; height?: number; style?: CSSProperties }) {
  return (
    <div className="lskel" aria-busy="true" aria-label={label} style={style}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={height} className={i > 0 ? 'skelgap' : undefined} />)}
    </div>
  );
}
