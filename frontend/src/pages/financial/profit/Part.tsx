import type { ReactNode } from 'react';
import { Button, Skeleton } from '../../../components/ui-v2';
import type { Block } from './useBlock';

interface PartProps<T> {
  /** What the block is called, for the error text ("Monthly profit and loss did not load"). */
  name: string;
  block: Block<T>;
  /** Height of the skeleton while the first answer is on its way. */
  height: number;
  children: (data: T) => ReactNode;
}

/** A card-sized block: a skeleton before the first answer, an error with Retry when it failed, the card when it has data. */
export function Part<T>({ name, block, height, children }: PartProps<T>) {
  if (block.failed) {
    return (
      <div className="card blockerr" role="alert">
        <div>
          <b>{name} did not load</b>
          <p>Something went wrong on our side.</p>
        </div>
        <Button size="mini" onClick={block.retry}>Retry</Button>
      </div>
    );
  }
  if (block.data === undefined) {
    return <div aria-busy={block.loading} aria-label={`Loading ${name}`}><Skeleton height={height} className="skelcard" /></div>;
  }
  return <div className={block.loading ? 'finbusy' : undefined} aria-busy={block.loading || undefined}>{children(block.data)}</div>;
}
