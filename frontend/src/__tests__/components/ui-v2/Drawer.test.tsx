import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from '../../../components/ui-v2';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open order</button>
      <Drawer open={open} onClose={() => { onClose(); setOpen(false); }} title="Order #1042" description="Abena Owusu" footer={<button type="button">Save</button>}>
        <a href="#call">Call</a>
      </Drawer>
    </>
  );
}

describe('ui-v2 Drawer', () => {
  it('is hidden from the accessibility tree while closed and shown while open', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.sheet')).not.toHaveClass('on');
    expect(document.querySelector('.sheet')).toHaveAttribute('inert');
    await userEvent.setup().click(screen.getByText('Open order'));
    expect(screen.getByRole('dialog', { name: 'Order #1042' })).toHaveClass('sheet', 'on');
    expect(document.querySelector('.scrim')).toHaveClass('on');
    expect(document.querySelector('.sheet')).not.toHaveAttribute('inert');
    expect(screen.getByText('Abena Owusu')).toBeInTheDocument();
  });
  it('moves focus in, closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText('Open order');
    await user.click(opener);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
  it('closes from the Close button and the scrim', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByText('Open order'));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('Open order'));
    await user.click(document.querySelector('.scrim') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('keeps Tab inside the open drawer', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('Open order'));
    const dlg = screen.getByRole('dialog');
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dlg).toContainElement(document.activeElement as HTMLElement);
    }
  });
});
