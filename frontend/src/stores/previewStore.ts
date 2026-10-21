import { create } from 'zustand';

interface PreviewState {
  /** Name shown in the banner. null = not in preview mode. Not persisted: a reload leaves preview mode. */
  asName: string | null;
  start: (name: string) => void;
  stop: () => void;
}

/**
 * Preview mode (F-103): the owner opens the rep or agent app as a person sees it. The banner says so and every write
 * (POST, PUT, PATCH, DELETE) is blocked in apiClient. Staff and roles (M6) calls start().
 */
export const usePreviewStore = create<PreviewState>((set) => ({
  asName: null,
  start: (asName) => set({ asName }),
  stop: () => set({ asName: null }),
}));

export const isPreviewMode = () => usePreviewStore.getState().asName !== null;
