import type { ReactNode } from 'react';
import { Skeleton } from '../../../components/ui-v2';
import { BlockError } from '../../dashboard/blocks/Frame';
import type { FinanceBlock } from './useBlock';

interface PartProps<T> {
  /** What the block is called, for the error text ("Monthly profit and loss did not load"). */
  name: string;
  block: FinanceBlock<T>;
  /** Height of the skeleton while the first answer is on its way. */
  height: number;
  children: (data: T) => ReactNode;
}

/** A card-sized block: a skeleton before the first answer, the Dashboard's error with Retry when it failed, the card when it has data. */
export function Part<T>({ name, block, height, children }: PartProps<T>) {
  if (block.status === 'failed') return <BlockError name={name} onRetry={block.retry} />;
  if (block.data === undefined) {
    return <div aria-busy="true" aria-label={`Loading ${name}`}><Skeleton height={height} className="skelcard" /></div>;
  }
  const busy = block.status === 'loading';
  return <div className={busy ? 'finbusy' : undefined} aria-busy={busy || undefined}>{children(block.data)}</div>;
}
