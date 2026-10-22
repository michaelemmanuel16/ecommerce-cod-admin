// Stand-in for the vite-plugin-pwa virtual module, so Vitest can resolve the import. Tests mock it with vi.mock.
export function useRegisterSW() {
  return { needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} };
}
