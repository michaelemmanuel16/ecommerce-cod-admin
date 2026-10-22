import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePopover } from '../../components/shell/usePopover';

interface PopMenuProps {
  label: string;
  icon: ReactNode;
  className?: string;
  /** The menu body. Call `close` after an item is chosen. */
  children: (close: () => void) => ReactNode;
}

/** A button with a menu under it (.mwrap > .btn + .menu), used by the bulk bar. */
export function PopMenu({ label, icon, className, children }: PopMenuProps) {
  const menu = usePopover();
  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className={`btn${className ? ` ${className}` : ''}`} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        {icon}
        {label}
        <ChevronDown style={{ width: 15, height: 15 }} />
      </button>
      {menu.open && (
        <div className="menu left" role="menu" aria-label={label}>
          {children(menu.close)}
        </div>
      )}
    </div>
  );
}
