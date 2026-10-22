import type { ReactNode } from 'react';
import { Skeleton } from '../../components/ui-v2';
import { BlockFrame } from '../dashboard/blocks/Frame';
import type { Block } from './types';

/** What every tab gets from the page. */
export interface TabControl {
  loading: boolean;
  /** The whole request failed and there is no data to show. */
  failed: boolean;
  compare: boolean;
  onRetry: () => void;
}

interface PartProps<T> {
  /** What the block is called, for the error text ("Tiles did not load"). */
  name: string;
  block: Block<T> | undefined;
  ctl: TabControl;
  /** Height of the skeleton while the first answer is on its way. */
  height: number;
  /** The error shows inline, not as its own card (the block sits inside a card). */
  bare?: boolean;
  children: (data: T) => ReactNode;
}

/** One block of a report: its own skeleton while loading and its own error with Retry when it failed (F-1050). */
export function Part<T>({ name, block, ctl, height, bare, children }: PartProps<T>) {
  return (
    <BlockFrame
      name={name} block={block} loading={ctl.loading} failed={ctl.failed} onRetry={ctl.onRetry} bare={bare}
      skeleton={<Skeleton height={height} className="skelcard" />}
    >
      {children}
    </BlockFrame>
  );
}
