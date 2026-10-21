import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Skeleton } from '../../../components/ui-v2';
import { isBlockError, type Block } from '../types';
import type { Info as InfoCopy } from '../copy';

interface BlockFrameProps<T> {
  /** What the block is called, for the error text. */
  name: string;
  block: Block<T> | undefined;
  /** No answer yet. */
  loading: boolean;
  /** The whole request failed and there is no block data. */
  failed: boolean;
  onRetry: () => void;
  /** The skeleton while the first answer is on its way. */
  skeleton: ReactNode;
  /** The error shows inline, not as its own card (the block sits inside a card). */
  bare?: boolean;
  children: (data: T) => ReactNode;
}

/** Per-block loading and error (F-200): a skeleton before the first answer, an inline error with Retry when the block failed. */
export function BlockFrame<T>({ name, block, loading, failed, onRetry, skeleton, bare, children }: BlockFrameProps<T>) {
  if (block === undefined) {
    if (failed) return <BlockError name={name} onRetry={onRetry} bare={bare} />;
    return <div aria-busy={loading} aria-label={`Loading ${name}`}>{skeleton}</div>;
  }
  if (isBlockError(block)) return <BlockError name={name} onRetry={onRetry} errorId={block.error.errorId} bare={bare} />;
  return <>{children(block)}</>;
}

export function BlockError({ name, onRetry, errorId, bare }: { name: string; onRetry: () => void; errorId?: string; bare?: boolean }) {
  return (
    <div className={bare ? 'blockerr' : 'card blockerr'} role="alert">
      <div>
        <b>{name} did not load</b>
        <p>Something went wrong on our side.{errorId && <span className="errid"> Error {errorId.slice(0, 8)}</span>}</p>
      </div>
      <Button size="mini" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function SkeletonCard({ height }: { height: number }) {
  return <Skeleton height={height} className="skelcard" />;
}

/**
 * The tooltip of a figure's label: name, formula and date basis (F-200). The label itself takes focus (tabIndex 0),
 * shows the tooltip on hover and keyboard focus, and closes on Escape. `linked`: the label is already a link, which is
 * the focus stop, so the wrapper adds none. The bubble sits in a portal with fixed coordinates, because the target
 * ladder clips its children (overflow hidden).
 */
export function Tip({ info, linked, children }: { info: InfoCopy; linked?: boolean; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const label = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !label.current) return;
    const r = label.current.getBoundingClientRect();
    const width = 280;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), Math.max(8, window.innerWidth - width - 8));
    setPos({ left, top: r.bottom + 8 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <span
        ref={label}
        className="tiplabel"
        tabIndex={linked ? undefined : 0}
        aria-describedby={id}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open && createPortal(
        <div className="v2">
          <div id={id} role="tooltip" className="infobubble" style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
            <b>{info.name}</b>
            <span><em>Formula</em> {info.formula}</span>
            <span><em>Date basis</em> {info.basis}</span>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
