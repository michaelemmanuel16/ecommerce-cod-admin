import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { FloatingMenu } from '../../pages/orders/FloatingMenu';

// Owner 2026-10-22: the status menu of a low row opened off the screen, so it took several clicks.
describe('FloatingMenu placement', () => {
  let menuHeight = 0;
  let resize: (() => void) | undefined;

  const anchorAt = (top: number, bottom: number) => {
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => ({ top, bottom, left: 100, right: 180, width: 80, height: bottom - top, x: 100, y: top, toJSON: () => ({}) });
    document.body.appendChild(anchor);
    return anchor;
  };

  const setup = () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => menuHeight);
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { resize = cb; }
      observe() {}
      disconnect() {}
    });
    window.innerHeight = 722;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resize = undefined;
  });

  it('opens up near the bottom of the window, with no top from the CSS', () => {
    setup();
    menuHeight = 200;
    render(<FloatingMenu anchor={anchorAt(660, 690)} label="Status" onClose={() => {}}><button>Confirmed</button></FloatingMenu>);
    const menu = screen.getByRole('menu');
    expect(menu.style.bottom).toBe(`${722 - 660 + 6}px`);
    expect(menu.style.top).toBe('');
  });

  it('moves up when the content grows after it opens', () => {
    setup();
    menuHeight = 14; // "Loading the moves…" fits below the button
    const anchor = anchorAt(560, 590);
    render(<FloatingMenu anchor={anchor} label="Status" onClose={() => {}}><button>Confirmed</button></FloatingMenu>);
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('596px');

    menuHeight = 300; // the moves loaded: it no longer fits below
    act(() => resize?.());
    expect(menu.style.bottom).toBe(`${722 - 560 + 6}px`);
    expect(menu.style.top).toBe('');
  });

  it('puts no stray text on the page', () => {
    setup();
    render(<FloatingMenu anchor={anchorAt(100, 130)} label="Status" onClose={() => {}}><button>Confirmed</button></FloatingMenu>);
    expect(document.body.textContent).not.toContain('A portal still sends');
  });
});
