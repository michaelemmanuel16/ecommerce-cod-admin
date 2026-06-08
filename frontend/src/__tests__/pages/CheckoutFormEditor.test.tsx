import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// --- service mocks (must be defined before importing the editor) -------------

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('../../services/checkout-forms.service', () => ({
  checkoutFormsService: {
    getCheckoutForm: vi.fn(async (id: number) => ({
      id,
      name: 'Magic Groove',
      slug: 'magic-groove',
      isActive: true,
      fields: [],
      packages: [],
      upsells: [],
    })),
    createCheckoutForm: vi.fn(),
    updateCheckoutForm: vi.fn(),
  },
}));

vi.mock('../../services/products.service', () => ({
  productsService: {
    getProducts: vi.fn(async () => []),
  },
}));

// Stub the builder. The editor is the unit under test; the builder is a
// black box that simply needs to expose onDirtyChange + submit handle.
vi.mock('../../components/forms/CheckoutFormBuilder', () => {
  const React = require('react');
  return {
    CheckoutFormBuilder: React.forwardRef(
      (
        props: { onDirtyChange?: (v: boolean) => void; onSave?: (data: any) => Promise<void> },
        ref: any
      ) => {
        React.useImperativeHandle(ref, () => ({ submit: () => {} }));
        return (
          <div data-testid="builder-stub">
            <button type="button" onClick={() => props.onDirtyChange?.(true)}>
              mark-dirty
            </button>
            <button type="button" onClick={() => props.onDirtyChange?.(false)}>
              mark-clean
            </button>
          </div>
        );
      }
    ),
  };
});

// Preview pane is unused here; stub to keep the tree light.
vi.mock('../../components/forms/CheckoutFormPreviewPane', () => ({
  CheckoutFormPreviewPane: () => <div data-testid="preview-pane" />,
}));

// Now import the editor.
import { CheckoutFormEditor } from '../../pages/CheckoutFormEditor';

const renderEditor = () =>
  render(
    <MemoryRouter initialEntries={['/checkout-forms/123/edit']}>
      <Routes>
        <Route path="/checkout-forms/:id/edit" element={<CheckoutFormEditor />} />
      </Routes>
    </MemoryRouter>
  );

describe('CheckoutFormEditor — unsaved-changes guard (R3)', () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Back navigates without prompting when the form is clean', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('builder-stub')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Back'));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/checkout-forms');
  });

  it('Back prompts via window.confirm when the form is dirty', async () => {
    (window.confirm as any).mockImplementation(() => true);
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('builder-stub')).toBeInTheDocument());

    fireEvent.click(screen.getByText('mark-dirty'));
    await waitFor(() => expect(screen.getByText('Unsaved')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Back'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/checkout-forms');
  });

  it('Back cancels navigation when the user declines the confirm', async () => {
    (window.confirm as any).mockImplementation(() => false);
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('builder-stub')).toBeInTheDocument());

    fireEvent.click(screen.getByText('mark-dirty'));
    await waitFor(() => expect(screen.getByText('Unsaved')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Back'));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('beforeunload preventDefault fires only while dirty', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('builder-stub')).toBeInTheDocument());

    // Clean state: beforeunload should NOT preventDefault.
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    const cleanSpy = vi.spyOn(cleanEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(cleanEvent);
    });
    expect(cleanSpy).not.toHaveBeenCalled();

    // Dirty state: should preventDefault.
    fireEvent.click(screen.getByText('mark-dirty'));
    await waitFor(() => expect(screen.getByText('Unsaved')).toBeInTheDocument());

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    const dirtySpy = vi.spyOn(dirtyEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(dirtyEvent);
    });
    expect(dirtySpy).toHaveBeenCalled();
  });
});
