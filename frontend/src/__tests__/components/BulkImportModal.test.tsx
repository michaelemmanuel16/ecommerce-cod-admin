import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkImportModal } from '../../components/orders/BulkImportModal';
import { ordersService } from '../../services/orders.service';

vi.mock('../../services/orders.service', () => ({
  ordersService: { uploadOrders: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const upload = async (checkIt: boolean) => {
  const { container } = render(<BulkImportModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
  const box = screen.getByLabelText(/Run workflows for imported orders/i) as HTMLInputElement;
  expect(box.checked).toBe(false);
  if (checkIt) await userEvent.click(box);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File(['a,b'], 'orders.csv', { type: 'text/csv' }));
  await userEvent.click(screen.getByRole('button', { name: /Start Import/i }));
};

describe('BulkImportModal run workflows switch', () => {
  beforeEach(() => {
    vi.mocked(ordersService.uploadOrders).mockReset();
    vi.mocked(ordersService.uploadOrders).mockResolvedValue({ results: { success: 0, failed: 0, duplicates: 0, errors: [] } });
  });

  it('is unchecked by default and uploads with runWorkflows false', async () => {
    await upload(false);
    await waitFor(() => expect(ordersService.uploadOrders).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ordersService.uploadOrders).mock.calls[0][1]).toBe(false);
  });

  it('uploads with runWorkflows true once ticked', async () => {
    await upload(true);
    await waitFor(() => expect(ordersService.uploadOrders).toHaveBeenCalledTimes(1));
    expect(vi.mocked(ordersService.uploadOrders).mock.calls[0][1]).toBe(true);
  });
});
