import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Open layers, newest last. Only the top one answers Escape and Tab, so a Modal opened from a Drawer closes first.
const stack: symbol[] = [];

/**
 * Keyboard behaviour shared by Modal, Drawer and ConfirmDialog while `open` is true:
 * focus moves into the layer, Tab stays inside it, Escape calls `onClose`,
 * and focus goes back to the element that had it before the layer opened.
 * `initialFocus` picks the element to focus first (for example the Cancel button); the default is the first focusable.
 */
export function useLayer(
  open: boolean,
  ref: RefObject<HTMLElement>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement>,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = Symbol('layer');
    stack.push(id);

    const items = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    (initialFocus?.current ?? items()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, ref, initialFocus]);
}
