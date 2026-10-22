import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Portal } from '../../components/ui-v2/Portal';

interface FloatingMenuProps {
  /** The button that opened it. The menu sits under it (or above, near the bottom of the screen). */
  anchor: HTMLElement;
  label: string;
  /** Which edge of the button the menu lines up with. */
  align?: 'left' | 'right';
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A menu fixed to the viewport (.menu.fixed of the mockup), so the table's scroll box cannot clip it.
 * Outside click, Escape, scrolling and a resize close it; Escape gives focus back to the button; Up and Down move between items.
 */
export function FloatingMenu({ anchor, label, align = 'right', width = 240, onClose, children }: FloatingMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 8, top: 0 });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
    const height = ref.current?.offsetHeight ?? 320;
    setPos(r.bottom + height + 12 > window.innerHeight && r.top > height
      ? { left, bottom: window.innerHeight - r.top + 6 }
      : { left, top: r.bottom + 6 });
  }, [anchor, align, width]);

  useEffect(() => {
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    items()[0]?.focus();
    const close = () => onClose();
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const at = list.indexOf(document.activeElement as HTMLElement);
        list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor, onClose]);

  return (
    <Portal>
      // A portal still sends React events up to its parent, and the parent can be a table row that opens the order.
      <div ref={ref} className="menu fixed" role="menu" aria-label={label} style={{ ...pos, width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </Portal>
  );
}
