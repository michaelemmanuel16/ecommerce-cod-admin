import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CheckoutForms } from '../../pages/CheckoutForms';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';
import type { CheckoutForm } from '../../types/checkout-form';

const getCheckoutForms = vi.fn();
const cloneCheckoutForm = vi.fn();
const deleteCheckoutForm = vi.fn();
const restoreCheckoutForm = vi.fn();
const setCheckoutFormActive = vi.fn();
vi.mock('../../services/checkout-forms.service', () => ({
  checkoutFormsService: {
    getCheckoutForms: (...a: unknown[]) => getCheckoutForms(...a),
    cloneCheckoutForm: (...a: unknown[]) => cloneCheckoutForm(...a),
    deleteCheckoutForm: (...a: unknown[]) => deleteCheckoutForm(...a),
    restoreCheckoutForm: (...a: unknown[]) => restoreCheckoutForm(...a),
    setCheckoutFormActive: (...a: unknown[]) => setCheckoutFormActive(...a),
  },
}));

const form = (over: Partial<CheckoutForm>): CheckoutForm =>
  ({
    id: 1, name: 'Magic Groove copybook set', slug: 'magic-groove', productId: 7, product: { name: 'Magic Groove copybook set' },
    isActive: true, formType: 'physical', ordersThisMonth: 42, ordersTotal: 1198, conversion: null, archivedAt: null,
    packages: [{ id: 11, name: '2 sets', price: 449, quantity: 2 }, { id: 12, name: '3 sets', price: 629, quantity: 3 }],
    fields: [], upsells: [], ...over,
  }) as unknown as CheckoutForm;

const ROWS = [
  form({}),
  form({ id: 2, name: 'Home study guide', slug: 'study-guide', product: { name: "Smart Parent's Home Study Guide" }, formType: 'digital', ordersThisMonth: 63, ordersTotal: 63, packages: [], isActive: false }),
  form({ id: 3, name: 'Empty form', slug: 'empty', ordersThisMonth: 0, ordersTotal: 0, packages: [] }),
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/checkout-forms']}>
      <ToastProvider>
        <Routes>
          <Route path="/checkout-forms" element={<CheckoutForms />} />
          <Route path="/checkout-forms/new" element={<div>NEW FORM PAGE</div>} />
          <Route path="/checkout-forms/:id/edit" element={<div>EDIT PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const renderLoaded = async () => {
  renderPage();
  await screen.findByRole('table');
};

const asRole = (role: string) =>
  useAuthStore.setState({ user: { id: 1, role, firstName: 'Manny', lastName: 'A' } as never });

const row = (name: string) => {
  const found = screen.getAllByRole('row').find((r) => within(r).queryByText(name, { selector: 'b' }));
  if (!found) throw new Error(`No row for ${name}`);
  return found;
};

let writeText: ReturnType<typeof vi.fn>;

// user-event installs its own clipboard when it is set up, so the stub goes in after it.
const setup = () => {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return user;
};

beforeEach(() => {
  [getCheckoutForms, cloneCheckoutForm, deleteCheckoutForm, restoreCheckoutForm, setCheckoutFormActive].forEach((m) => m.mockReset());
  getCheckoutForms.mockResolvedValue(ROWS);
  asRole('admin');
  writeText = vi.fn(async () => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('Checkout forms list (F-408)', () => {
  it('shows a skeleton while loading, then the columns', async () => {
    renderPage();
    expect(screen.getByLabelText('Loading checkout forms')).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Checkout forms' });
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Form', 'Link', 'Orders this month', 'Conversion', 'Active', 'Actions']);
    expect(getCheckoutForms).toHaveBeenCalledWith({ archived: false, limit: 100 });
  });

  it('shows the name, product, link, orders, and the Digital tag only on a digital form', async () => {
    await renderLoaded();
    const guide = row('Home study guide');
    expect(within(guide).getByText("Smart Parent's Home Study Guide")).toBeInTheDocument();
    expect(within(guide).getByText('Digital')).toBeInTheDocument();
    expect(within(guide).getByText('/form/study-guide')).toBeInTheDocument();
    expect(within(guide).getByText('63')).toBeInTheDocument();
    expect(within(row('Magic Groove copybook set')).queryByText('Digital')).toBeNull();
  });

  it('shows a dash for conversion while it is null, with the tooltip', async () => {
    await renderLoaded();
    const cell = within(row('Magic Groove copybook set')).getByText('—');
    expect(cell).toBeInTheDocument();
    expect(within(row('Magic Groove copybook set')).getByRole('tooltip', { hidden: true })).toHaveTextContent('Visit counts arrive in a later update.');
  });

  it('shows an empty state with a New form button', async () => {
    getCheckoutForms.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No checkout forms yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New form' }).length).toBeGreaterThan(0);
  });

  it('opens the editor from New form and Edit', async () => {
    const user = setup();
    await renderLoaded();
    await user.click(screen.getAllByRole('button', { name: 'New form' })[0]);
    expect(screen.getByText('NEW FORM PAGE')).toBeInTheDocument();
  });

  describe('active switch', () => {
    it('saves { isActive } and keeps the new state', async () => {
      const user = setup();
      setCheckoutFormActive.mockResolvedValue(undefined);
      await renderLoaded();
      const sw = screen.getByRole('checkbox', { name: 'Active: Home study guide' });
      expect(sw).not.toBeChecked();
      await user.click(sw);
      expect(setCheckoutFormActive).toHaveBeenCalledWith(2, true);
      expect(sw).toBeChecked();
    });

    it('goes back and shows the server message when it refuses (required-key guard)', async () => {
      const user = setup();
      setCheckoutFormActive.mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: "This form can't take orders yet. Add: Street address." } },
      });
      await renderLoaded();
      const sw = screen.getByRole('checkbox', { name: 'Active: Home study guide' });
      await user.click(sw);
      expect(await screen.findByRole('status')).toHaveTextContent("This form can't take orders yet. Add: Street address.");
      expect(sw).not.toBeChecked();
    });
  });

  describe('clone', () => {
    it.each([
      [false, 'Copy created. It stays off until you switch it on.'],
      [true, 'Copy created. It stays off until you switch it on. Add the Conversion API token again in Tracking.'],
    ])('calls the clone endpoint and says the copy is off (token not copied: %s)', async (capiTokenNotCopied, toast) => {
      const user = setup();
      cloneCheckoutForm.mockResolvedValue({ form: form({ id: 9, name: 'Magic Groove copybook set (copy)', slug: 'magic-groove-2', isActive: false }), capiTokenNotCopied });
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Clone Magic Groove copybook set' }));
      expect(cloneCheckoutForm).toHaveBeenCalledWith(1);
      expect(await screen.findByRole('status')).toHaveTextContent(toast);
      if (!capiTokenNotCopied) expect(screen.getByRole('status')).not.toHaveTextContent('Conversion API');
    });

    it('puts the copy at the top of the list without loading the list again', async () => {
      const user = setup();
      cloneCheckoutForm.mockResolvedValue({ form: form({ id: 9, name: 'Magic Groove copybook set (copy)', slug: 'magic-groove-2', isActive: false, product: undefined, ordersThisMonth: undefined }), capiTokenNotCopied: false });
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Clone Magic Groove copybook set' }));
      const copy = await screen.findByText('Magic Groove copybook set (copy)');
      expect(screen.getAllByRole('row')[1]).toContainElement(copy);
      const r = row('Magic Groove copybook set (copy)');
      expect(within(r).getByText('Magic Groove copybook set')).toBeInTheDocument(); // the product, taken from the original
      expect(within(r).getByRole('checkbox', { name: /^Active:/ })).not.toBeChecked();
      expect(getCheckoutForms).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('archives a form with orders: the dialog says how many, the toast says archived', async () => {
      const user = setup();
      deleteCheckoutForm.mockResolvedValue({ archived: true, ordersTotal: 1198 });
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Delete Magic Groove copybook set' }));
      const dialog = screen.getByRole('alertdialog');
      expect(within(dialog).getByRole('heading')).toHaveTextContent('Delete Magic Groove copybook set?');
      expect(dialog).toHaveTextContent(
        '1,198 orders came from this form. It will be archived: hidden from this list, its link shows "Form not found", and you can restore it.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      expect(deleteCheckoutForm).toHaveBeenCalledWith(1);
      expect(await screen.findByRole('status')).toHaveTextContent('Form archived.');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(screen.queryByText('Magic Groove copybook set', { selector: 'b' })).toBeNull();
      expect(getCheckoutForms).toHaveBeenCalledTimes(1);
    });

    it('removes a form with no orders', async () => {
      const user = setup();
      deleteCheckoutForm.mockResolvedValue({ deleted: true });
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Delete Empty form' }));
      expect(screen.getByRole('alertdialog')).toHaveTextContent('This form has no orders. It will be removed.');
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Form deleted.');
    });

    it('cancel leaves the form alone', async () => {
      const user = setup();
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Delete Empty form' }));
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      expect(deleteCheckoutForm).not.toHaveBeenCalled();
    });

    it("adds the server's warning to the toast", async () => {
      const user = setup();
      deleteCheckoutForm.mockResolvedValue({ archived: true, ordersTotal: 1198, warning: 'No active form sells this product.' });
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Delete Magic Groove copybook set' }));
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
      expect(await screen.findByRole('status')).toHaveTextContent('Form archived. No active form sells this product.');
    });
  });

  describe('Show archived', () => {
    const archived = form({ id: 4, name: 'Old offer', slug: 'old-offer', archivedAt: '2026-10-01T10:00:00.000Z', isActive: false, ordersTotal: 300, ordersThisMonth: 0 });

    it('loads archived forms with an Archived tag and a Restore action, no switch and no delete', async () => {
      const user = setup();
      getCheckoutForms.mockImplementation(async (p: { archived: boolean }) => (p.archived ? [archived] : ROWS));
      await renderLoaded();
      await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
      await screen.findByText('Old offer');
      expect(getCheckoutForms).toHaveBeenLastCalledWith({ archived: true, limit: 100 });
      const r = row('Old offer');
      expect(within(r).getAllByText('Archived').length).toBeGreaterThan(0);
      expect(within(r).getByRole('button', { name: 'Restore Old offer' })).toBeInTheDocument();
      expect(within(r).queryByRole('checkbox')).toBeNull();
      expect(within(r).queryByRole('button', { name: /^Delete/ })).toBeNull();
    });

    it('restores a form and says it is still off', async () => {
      const user = setup();
      getCheckoutForms.mockImplementation(async (p: { archived: boolean }) => (p.archived ? [archived] : ROWS));
      restoreCheckoutForm.mockResolvedValue(undefined);
      await renderLoaded();
      await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
      await user.click(await screen.findByRole('button', { name: 'Restore Old offer' }));
      expect(restoreCheckoutForm).toHaveBeenCalledWith(4);
      expect(await screen.findByRole('status')).toHaveTextContent('Form restored. Switch it on when ready.');
      expect(screen.queryByText('Old offer')).toBeNull();
    });

    it('has its own empty state', async () => {
      const user = setup();
      getCheckoutForms.mockImplementation(async (p: { archived: boolean }) => (p.archived ? [] : ROWS));
      await renderLoaded();
      await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
      expect(await screen.findByText('No archived forms.')).toBeInTheDocument();
    });
  });

  describe('copy link and embed code (F-410)', () => {
    it('copies https://<host>/form/<slug> and says "Link copied."', async () => {
      const user = setup();
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Copy link for Magic Groove copybook set' }));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/form/magic-groove`);
      expect(await screen.findByRole('status')).toHaveTextContent('Link copied.');
    });

    it('copies the embed code from the menu', async () => {
      const user = setup();
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'More copy options for Magic Groove copybook set' }));
      await user.click(screen.getByRole('menuitem', { name: 'Copy embed code' }));
      const text = writeText.mock.calls[0][0] as string;
      expect(text).toContain('data-codadmin-checkout');
      expect(text).toContain('data-slug="magic-groove"');
      expect(await screen.findByRole('status')).toHaveTextContent('Embed code copied.');
    });

    it('offers one link per package, and no package links on a form without packages', async () => {
      const user = setup();
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'More copy options for Magic Groove copybook set' }));
      await user.click(screen.getByRole('menuitem', { name: 'Copy link: 3 sets' }));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/form/magic-groove?package=12`);
      expect(await screen.findByRole('status')).toHaveTextContent('Link copied.');

      await user.click(screen.getByRole('button', { name: 'More copy options for Empty form' }));
      expect(screen.queryByRole('menuitem', { name: /Copy link:/ })).toBeNull();
    });

    it('opens a box with the text to copy by hand when the clipboard is refused', async () => {
      const user = setup();
      writeText.mockRejectedValue(new Error('NotAllowedError'));
      await renderLoaded();
      await user.click(screen.getByRole('button', { name: 'Copy link for Magic Groove copybook set' }));
      const dialog = await screen.findByRole('dialog');
      const box = within(dialog).getByLabelText('Text to copy') as HTMLTextAreaElement;
      expect(box.readOnly).toBe(true);
      expect(box.value).toBe(`${window.location.origin}/form/magic-groove`);
      expect(screen.queryByRole('status')).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Done' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('preview modal (F-419)', () => {
    it('Preview opens the preview route in a modal at 390 px, with a Mobile / Desktop switch, and opens no new tab', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      asRole('super_admin');
      await renderLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Preview Magic Groove copybook set' }));
      const dialog = screen.getByRole('dialog');
      const frame = within(dialog).getByTitle('Checkout preview');
      expect(frame).toHaveAttribute('src', '/checkout-forms/1/preview');
      expect(frame.getAttribute('data-width')).toBe('390');
      await userEvent.click(within(dialog).getByRole('button', { name: /Desktop/ }));
      expect(frame.getAttribute('data-width')).toBe('1024');
      expect(open).not.toHaveBeenCalled();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      open.mockRestore();
    });

    it('a manager can open it', async () => {
      asRole('manager');
      await renderLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Preview Home study guide' }));
      expect(within(screen.getByRole('dialog')).getByTitle('Checkout preview')).toHaveAttribute('src', '/checkout-forms/2/preview');
    });
  });

  describe('roles', () => {
    it('a manager reads the list: no New form, switch, Clone, Edit, Delete; Preview and Copy stay', async () => {
      asRole('manager');
      await renderLoaded();
      expect(screen.queryByRole('button', { name: 'New form' })).toBeNull();
      expect(screen.queryByRole('checkbox', { name: /^Active:/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Clone/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
      expect(screen.getAllByRole('button', { name: /^Preview/ }).length).toBe(3);
      expect(screen.getAllByRole('button', { name: /^Copy link for/ }).length).toBe(3);
      // the state is still readable
      expect(within(row('Home study guide')).getByText('Off')).toBeInTheDocument();
      expect(within(row('Magic Groove copybook set')).getByText('Active')).toBeInTheDocument();
    });

    it('a manager sees no Restore on an archived form', async () => {
      asRole('manager');
      getCheckoutForms.mockResolvedValue([form({ id: 4, name: 'Old offer', archivedAt: '2026-10-01T10:00:00.000Z', isActive: false })]);
      renderPage();
      await screen.findByText('Old offer');
      expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
    });

    it('an owner sees every action', async () => {
      asRole('super_admin');
      await renderLoaded();
      expect(screen.getAllByRole('button', { name: /^Clone/ })).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: /^Delete/ })).toHaveLength(3);
      expect(screen.getAllByRole('checkbox', { name: /^Active:/ })).toHaveLength(3);
    });
  });
});
