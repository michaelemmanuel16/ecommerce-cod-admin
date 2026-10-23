import { Menu, Moon, Search, Sparkles } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useShellStore } from '../../stores/shellStore';
import { NotificationMenu } from './NotificationMenu';
import { UserMenu } from './UserMenu';

interface TopBarProps {
  mobileOpen: boolean;
  onToggleMobileMenu: () => void;
}

/** <header class="top"> of products.html. The search box and Ask agent only flip the mount-point flags; the palette (M3-T35) and the drawer (M11) read them. */
export function TopBar({ mobileOpen, onToggleMobileMenu }: TopBarProps) {
  const [, toggleTheme] = useTheme();
  const setPaletteOpen = useShellStore((s) => s.setPaletteOpen);
  const setDrawerOpen = useShellStore((s) => s.setDrawerOpen);

  return (
    <header className="top">
      <button
        type="button"
        className="ibtn menubtn"
        onClick={onToggleMobileMenu}
        aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        aria-controls="app-sidebar"
        aria-expanded={mobileOpen}
      >
        <Menu />
      </button>
      <button type="button" className="search" onClick={() => setPaletteOpen(true)}>
        <Search />Search orders, customers or ask the agent…<kbd>⌘K</kbd>
      </button>
      <div className="spacer" />
      <button type="button" className="ibtn" onClick={toggleTheme} aria-label="Toggle dark mode"><Moon /></button>
      <NotificationMenu />
      <button type="button" className="agentbtn" onClick={() => setDrawerOpen(true)}>
        <Sparkles className="spark" /><span>Ask agent</span>
      </button>
      <UserMenu />
    </header>
  );
}
