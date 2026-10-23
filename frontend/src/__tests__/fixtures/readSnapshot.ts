export const snapshot = <T,>(screen: { getByTestId: (id: string) => HTMLElement }, id: string): T =>
  JSON.parse(screen.getByTestId(id).textContent || 'null');
