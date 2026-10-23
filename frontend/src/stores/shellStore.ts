import { create } from 'zustand';
import { navService, type NavCounts } from '../services/nav.service';

interface ShellState {
  /** null until the first answer, and after a failed request: the pills hide and the menu still works (F-101). */
  counts: NavCounts | null;
  fetchCounts: () => Promise<void>;
  /** Mount points for the command palette (M3-T35) and the AI drawer (M11). The shell only flips the flags. */
  paletteOpen: boolean;
  drawerOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
}

export const useShellStore = create<ShellState>((set) => ({
  counts: null,
  fetchCounts: async () => {
    try {
      set({ counts: await navService.getCounts() });
    } catch {
      set({ counts: null });
    }
  },
  paletteOpen: false,
  drawerOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
}));
