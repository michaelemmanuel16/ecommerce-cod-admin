import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../utils/test-utils';
import { Modal } from '../../components/ui/Modal';

describe('ui/Modal closeOnEscape', () => {
  it('closes on Escape when asked, also while an input has focus', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose} title="T" closeOnEscape><input aria-label="date" type="date" /></Modal>);
    const input = screen.getByLabelText('date');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Escape by default, so the other screens keep their behaviour', () => {
    const onClose = vi.fn();
    render(<Modal isOpen onClose={onClose} title="T"><p>x</p></Modal>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only the top modal when two are open', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal isOpen onClose={outer} title="outer" closeOnEscape><p>a</p></Modal>
        <Modal isOpen onClose={inner} title="inner" closeOnEscape><p>b</p></Modal>
      </>
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('stops listening when the modal closes', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Modal isOpen onClose={onClose} title="T" closeOnEscape><p>x</p></Modal>);
    rerender(<Modal isOpen={false} onClose={onClose} title="T" closeOnEscape><p>x</p></Modal>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
