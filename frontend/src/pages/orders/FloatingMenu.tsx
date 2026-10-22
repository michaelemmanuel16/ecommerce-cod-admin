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
 * Outside click, Escape, scrolling outside it and a resize close it; a long list scrolls inside it; Escape gives focus back to the button; Up and Down move between items.
 */
export function FloatingMenu({ anchor, label, align = 'right', width = 240, onClose, children }: FloatingMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 8, top: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
      // scrollHeight: the full content, also when maxHeight cuts the box
      const height = ref.current?.scrollHeight ?? 320;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      // A list longer than the space scrolls inside the menu, so its last items stay on the screen
      setPos(height > below && above > below
        ? { left, bottom: window.innerHeight - r.top + 6, maxHeight: above }
        : { left, top: r.bottom + 6, maxHeight: below });
    };
    place();
    // The content can grow after it opens (the status moves load later): place it again when its size changes
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [anchor, align, width]);

  useEffect(() => {
    const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    items()[0]?.focus();
    const close = () => onClose();
    // A scroll inside the menu (a long list) keeps it open
    const scroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
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
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor, onClose]);

  return (
    <Portal>
      {/* A portal still sends React events up to its parent, and the parent can be a table row that opens the order. */}
      <div ref={ref} className="menu fixed" role="menu" aria-label={label} style={{ ...pos, width }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </Portal>
  );
}
