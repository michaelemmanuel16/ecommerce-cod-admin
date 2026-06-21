import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CopyURLButton, CopyEmbedButton } from '../../components/forms/CopyActions';

const form = { slug: 'magic-groove', name: 'Magic Groove' };

describe('CopyActions', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeTextMock = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('CopyURLButton', () => {
    it('writes the public form URL to the clipboard on click', async () => {
      render(<CopyURLButton form={form} label="Copy URL" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      const arg = writeTextMock.mock.calls[0][0] as string;
      expect(arg).toMatch(/\/form\/magic-groove$/);
    });

    it('shows the Copied feedback for 2 seconds then reverts', async () => {
      render(<CopyURLButton form={form} label="Copy URL" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(screen.getByText('Copied')).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByText('Copied')).toBeNull();
      expect(screen.getByText('Copy URL')).toBeInTheDocument();
    });
  });

  describe('CopyEmbedButton', () => {
    it('writes the inline widget snippet (data-codadmin-checkout + embed.js) to the clipboard on click', async () => {
      render(<CopyEmbedButton form={form} label="Copy Embed" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(writeTextMock).toHaveBeenCalledTimes(1);
      const snippet = writeTextMock.mock.calls[0][0] as string;
      expect(snippet).toContain('data-codadmin-checkout');
      expect(snippet).toContain('data-slug="magic-groove"');
      expect(snippet).toContain('/embed.js');
    });

    it('shows the Copied feedback after click', async () => {
      render(<CopyEmbedButton form={form} label="Copy Embed" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      expect(screen.getByText('Copied')).toBeInTheDocument();
    });

    it('does not crash when clipboard.writeText rejects (e.g. insecure context)', async () => {
      writeTextMock.mockRejectedValueOnce(new Error('NotAllowedError'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      render(<CopyEmbedButton form={form} label="Copy Embed" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button'));
      });
      // No "Copied" because the await rejected.
      expect(screen.queryByText('Copied')).toBeNull();
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });
});
