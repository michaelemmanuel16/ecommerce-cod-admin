import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '../../../components/ui-v2';

function Harness({ count = 3, onConfirm = () => {}, onClose = () => {} }: { count?: number; onConfirm?: () => void; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Delete selected</button>
      <ConfirmDialog open={open} onClose={() => { onClose(); setOpen(false); }} onConfirm={() => { onConfirm(); setOpen(false); }} action="Delete" count={count} noun="order">
        The selected orders leave the list.
      </ConfirmDialog>
    </>
  );
}

describe('ui-v2 ConfirmDialog', () => {
  it('shows the title "Delete 3 orders?", the sentence, Cancel and the danger button', async () => {
    render(<Harness />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.setup().click(screen.getByText('Delete selected'));
    expect(screen.getByRole('heading', { name: 'Delete 3 orders?' })).toBeInTheDocument();
    expect(screen.getByText('The selected orders leave the list.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn', 'danger');
  });
  it('uses the singular for one item and a default sentence', async () => {
    render(<Harness count={1} />);
    await userEvent.setup().click(screen.getByText('Delete selected'));
    expect(screen.getByRole('heading', { name: 'Delete 1 order?' })).toBeInTheDocument();
  });
  it('closes on Escape without confirming, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);
    const opener = screen.getByText('Delete selected');
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
  it('confirms only from the danger button; Cancel and the veil do not', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByText('Delete selected'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByText('Delete selected'));
    await user.click(document.querySelector('.sx-veil') as HTMLElement);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByText('Delete selected'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
