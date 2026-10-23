import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../../../components/ui-v2';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <Modal open={open} onClose={() => { onClose(); setOpen(false); }} title="Import orders" description="CSV only" footer={<button type="button">Save</button>}>
        <input aria-label="File name" />
      </Modal>
    </>
  );
}

describe('ui-v2 Modal', () => {
  it('renders nothing while closed and a labelled dialog while open', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.setup().click(screen.getByText('Open it'));
    const dlg = screen.getByRole('dialog', { name: 'Import orders' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(dlg).toHaveClass('dlg');
    expect(screen.getByText('CSV only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
  it('moves focus into the dialog, closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText('Open it');
    await user.click(opener);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('Open it'));
    const dlg = screen.getByRole('dialog');
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dlg).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dlg).toContainElement(document.activeElement as HTMLElement);
  });
  it('closes from the Close button and from a click on the veil, not from a click inside', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText('Open it'));
    await user.click(screen.getByLabelText('File name'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('Open it'));
    await user.click(document.querySelector('.mveil') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
