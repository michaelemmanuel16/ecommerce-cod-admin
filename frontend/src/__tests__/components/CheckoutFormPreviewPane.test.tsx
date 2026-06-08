import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CheckoutFormPreviewPane } from '../../components/forms/CheckoutFormPreviewPane';

const sendReady = () => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'checkout-preview-ready' },
        origin: window.location.origin,
      })
    );
  });
};

const sendReadyFromOrigin = (origin: string) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'checkout-preview-ready' },
        origin,
      })
    );
  });
};

describe('CheckoutFormPreviewPane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an iframe pointing at the create-preview route when formId is null', () => {
    render(<CheckoutFormPreviewPane formId={null} draft={{}} />);
    const iframe = screen.getByTitle('Checkout preview') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('src')).toBe('/checkout-forms/new/preview');
  });

  it('streams the draft in create mode (formId null) once the child is ready', () => {
    render(<CheckoutFormPreviewPane formId={null} draft={{ name: 'Draft Form' }} debounceMs={50} />);
    const iframe = screen.getByTitle('Checkout preview') as HTMLIFrameElement;
    const win = iframe.contentWindow;
    if (!win) throw new Error('no iframe contentWindow');
    const postSpy = vi.spyOn(win, 'postMessage');

    sendReady();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0]).toMatchObject({
      type: 'checkout-preview-update',
      patch: { name: 'Draft Form' },
    });
  });

  it('renders an iframe pointing at /checkout-forms/:id/preview when formId is set', () => {
    render(<CheckoutFormPreviewPane formId={42} draft={{}} />);
    const iframe = screen.getByTitle('Checkout preview') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('src')).toBe('/checkout-forms/42/preview');
  });

  it('exposes desktop + mobile device toggle buttons', () => {
    render(<CheckoutFormPreviewPane formId={1} draft={{}} />);
    expect(screen.getByTitle('Desktop')).toBeInTheDocument();
    expect(screen.getByTitle('Mobile')).toBeInTheDocument();
  });

  it('does NOT post the draft until the child sends a ready handshake', () => {
    render(<CheckoutFormPreviewPane formId={1} draft={{ name: 'Magic Groove' }} debounceMs={50} />);
    const iframe = screen.getByTitle('Checkout preview') as HTMLIFrameElement;
    const win = iframe.contentWindow;
    if (!win) throw new Error('no iframe contentWindow');
    const postSpy = vi.spyOn(win, 'postMessage');

    // Advance past the debounce window. Without a ready ping the effect
    // returns early so nothing should be posted.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(postSpy).not.toHaveBeenCalled();

    // Once the child signals ready, the next debounce tick posts the draft.
    sendReady();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin] = postSpy.mock.calls[0];
    expect(payload).toMatchObject({
      type: 'checkout-preview-update',
      patch: { name: 'Magic Groove' },
    });
    expect(targetOrigin).toBe(window.location.origin);
  });

  it('rejects ready messages from a foreign origin (no childReady, no post)', () => {
    render(<CheckoutFormPreviewPane formId={1} draft={{ name: 'X' }} debounceMs={20} />);
    const iframe = screen.getByTitle('Checkout preview') as HTMLIFrameElement;
    const win = iframe.contentWindow!;
    const postSpy = vi.spyOn(win, 'postMessage');

    sendReadyFromOrigin('https://attacker.example.com');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('replays the current draft when a fresh ready ping arrives (iframe reload)', () => {
    const draft = { name: 'First' };
    render(<CheckoutFormPreviewPane formId={1} draft={draft} debounceMs={20} />);
    const iframe = screen.getByTitle('Checkout preview') as HTMLIFrameElement;
    const win = iframe.contentWindow!;
    const postSpy = vi.spyOn(win, 'postMessage');

    // First handshake + drain.
    sendReady();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const firstCalls = postSpy.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);

    // Iframe reloads → child sends another ready ping. Pane must replay the
    // current draft so the freshly-loaded child gets the overlay back.
    sendReady();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(postSpy.mock.calls.length).toBeGreaterThan(firstCalls);
  });
});
