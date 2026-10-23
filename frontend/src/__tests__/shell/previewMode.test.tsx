import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { InternalAxiosRequestConfig } from 'axios';
import { PreviewBanner } from '../../components/shell/PreviewBanner';
import { usePreviewStore } from '../../stores/previewStore';
import { apiClient } from '../../services/api';

const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
  data: {}, status: 200, statusText: 'OK', headers: {}, config,
}));

beforeEach(() => {
  adapter.mockClear();
  apiClient.defaults.adapter = adapter as never;
  usePreviewStore.setState({ asName: null });
});

describe('preview mode (F-103)', () => {
  it('shows no banner outside preview mode', () => {
    render(<PreviewBanner />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows "Preview as <name>" and Exit leaves preview mode', () => {
    usePreviewStore.getState().start('Ama Mensah');
    render(<PreviewBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Preview as Ama Mensah');
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(usePreviewStore.getState().asName).toBeNull();
  });

  it('blocks writes and lets reads through while previewing', async () => {
    usePreviewStore.getState().start('Ama Mensah');
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await expect(apiClient.request({ method, url: '/api/orders/1' })).rejects.toBeTruthy();
    }
    expect(adapter).not.toHaveBeenCalled();
    await apiClient.get('/api/orders');
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('sends writes outside preview mode', async () => {
    await apiClient.post('/api/orders', {});
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
