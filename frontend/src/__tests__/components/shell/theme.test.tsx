import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTheme } from '../../../hooks/useTheme';
import { THEME_KEY } from '../../../utils/theme';

const systemPrefersDark = (dark: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: dark && query.includes('dark'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  );

// The moon button is a thin wrapper over the hook; the shell test clicks the real one.
function MoonButton() {
  const [, toggle] = useTheme();
  return <button type="button" onClick={toggle}>moon</button>;
}

const theme = () => document.documentElement.getAttribute('data-theme');

describe('dark mode', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => vi.restoreAllMocks());

  it('the toggle flips data-theme and the choice persists across a reload', async () => {
    systemPrefersDark(false);
    const first = render(<MoonButton />);
    expect(theme()).toBe('light');

    await userEvent.click(screen.getByRole('button', { name: 'moon' }));
    expect(theme()).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');

    // a reload: the saved choice wins over the system setting
    first.unmount();
    document.documentElement.removeAttribute('data-theme');
    render(<MoonButton />);
    expect(theme()).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'moon' }));
    expect(theme()).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('first visit follows the system setting', () => {
    systemPrefersDark(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('dark');
    expect(theme()).toBe('dark');
  });

  it('with localStorage throwing, the page follows the system setting and the toggle still works', () => {
    systemPrefersDark(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useTheme());
    expect(theme()).toBe('dark');

    act(() => result.current[1]());
    expect(theme()).toBe('light');
  });

  it('a stored choice beats the system setting', () => {
    systemPrefersDark(true);
    localStorage.setItem(THEME_KEY, 'light');
    renderHook(() => useTheme());
    expect(theme()).toBe('light');
  });
});
