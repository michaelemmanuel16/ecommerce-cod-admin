import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArchiveRestore, CopyPlus, Eye, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useV2Page } from '../components/shell/useV2Page';
import { Button, Card, ConfirmDialog, EmptyState, Skeleton, Table, Tag, Tooltip, useToast, type Column } from '../components/ui-v2';
import { checkoutFormsService } from '../services/checkout-forms.service';
import { useAuthStore } from '../stores/authStore';
import { apiErrorMessage } from '../utils/apiError';
import { formatNumber } from '../utils/format';
import { copyText } from '../hooks/useCopyToClipboard';
import type { CheckoutForm } from '../types/checkout-form';
import { CopyFallbackModal } from './checkoutForms/CopyFallbackModal';
import { PreviewModal } from './checkoutForms/PreviewModal';
import { LinkCell, type CopyText } from './checkoutForms/LinkCell';

/** The delete sentence: a form with orders is archived and can come back; an empty one is removed (F-408). */
const deleteText = (form: CheckoutForm): string => {
  const orders = form.ordersTotal ?? 0;
  if (orders === 0) return 'This form has no orders. It will be removed.';
  const came = orders === 1 ? 'order came' : 'orders came';
  return `${formatNumber(orders)} ${came} from this form. It will be archived: hidden from this list, its link shows "Form not found", and you can restore it.`;
};

/** One icon button of the Actions column: the name carries the form, the title is the plain verb. */
function RowAction({ verb, form, icon, danger, disabled, onClick }: { verb: string; form: CheckoutForm; icon: ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button size="icon-sm" className={danger ? 'dng' : undefined} aria-label={`${verb} ${form.name}`} title={verb} disabled={disabled} onClick={onClick}>
      {icon}
    </Button>
  );
}

/**
 * The Checkout forms list (M3b-T10, F-408, F-410), built from docs/mockups/v2/checkout-forms.html.
 * Owner and admin change forms; a manager reads the list and can preview and copy links.
 */
export function CheckoutForms() {
  useV2Page();
  const navigate = useNavigate();
  const say = useToast();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'super_admin' || role === 'admin';

  const [showArchived, setShowArchived] = useState(false);
  const [forms, setForms] = useState<CheckoutForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CheckoutForm | null>(null);
  const [previewing, setPreviewing] = useState<CheckoutForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ title: string; text: string } | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (archived: boolean) => {
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      // The API pages by 100; a store with more forms than that is far away.
      const rows = await checkoutFormsService.getCheckoutForms({ archived, limit: 100 });
      if (call === latest.current) setForms(rows);
    } catch (e) {
      if (call === latest.current) setError(apiErrorMessage(e, 'The checkout forms could not be loaded.'));
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(showArchived);
  }, [load, showArchived]);

  const copy = useCallback<CopyText>(
    async (text, done, title) => {
      if (await copyText(text)) say(done);
      else setManual({ title, text });
    },
    [say],
  );

  const toggleActive = async (form: CheckoutForm, isActive: boolean) => {
    setForms((rows) => rows.map((r) => (r.id === form.id ? { ...r, isActive } : r)));
    try {
      await checkoutFormsService.setCheckoutFormActive(form.id, isActive);
    } catch (e) {
      setForms((rows) => rows.map((r) => (r.id === form.id ? { ...r, isActive: form.isActive } : r)));
      say(apiErrorMessage(e, 'The form could not be updated.'));
    }
  };

  // One run for clone, delete and restore: busy while it works, its sentence as the toast, the failure sentence on error.
  const act = async (run: () => Promise<string>, failure: string) => {
    setBusy(true);
    try {
      say(await run());
    } catch (e) {
      say(apiErrorMessage(e, failure));
    } finally {
      setBusy(false);
    }
  };

  const clone = (form: CheckoutForm) =>
    act(async () => {
      const { form: made, capiTokenNotCopied } = await checkoutFormsService.cloneCheckoutForm(form.id);
      // The reply is the bare form: it has no product or order counts yet.
      setForms((rows) => [{ ...made, product: made.product ?? form.product, ordersThisMonth: 0, ordersTotal: 0, conversion: null }, ...rows]);
      return `Copy created. It stays off until you switch it on.${capiTokenNotCopied ? ' Add the Conversion API token again in Tracking.' : ''}`;
    }, 'The form could not be copied.');

  const confirmDelete = () => {
    const form = deleting;
    if (!form) return;
    setDeleting(null);
    void act(async () => {
      const result = await checkoutFormsService.deleteCheckoutForm(form.id);
      setForms((rows) => rows.filter((r) => r.id !== form.id));
      // One toast shows at a time, so the product warning rides on the same message.
      const done = result.archived ? 'Form archived.' : 'Form deleted.';
      return result.warning ? `${done} ${result.warning}` : done;
    }, 'The form could not be deleted.');
  };

  const restore = (form: CheckoutForm) =>
    act(async () => {
      await checkoutFormsService.restoreCheckoutForm(form.id);
      setForms((rows) => rows.filter((r) => r.id !== form.id));
      return 'Form restored. Switch it on when ready.';
    }, 'The form could not be restored.');

  const columns: Column<CheckoutForm>[] = [
    {
      key: 'form',
      header: 'Form',
      render: (f) => (
        <div className="who">
          <div className="icn"><FileText aria-hidden="true" /></div>
          <div>
            <b>{f.name || 'Untitled form'}</b>
            {f.formType === 'digital' && <Tag className="formtag">Digital</Tag>}
            {f.archivedAt && <Tag tone="warn" className="formtag">Archived</Tag>}
            <small>{f.product?.name}</small>
          </div>
        </div>
      ),
    },
    { key: 'link', header: 'Link', render: (f) => <LinkCell form={f} copy={copy} /> },
    { key: 'orders', header: 'Orders this month', right: true, render: (f) => <b className="num">{formatNumber(f.ordersThisMonth ?? 0)}</b> },
    {
      key: 'conversion',
      header: 'Conversion',
      right: true,
      render: (f) =>
        f.conversion == null ? (
          <Tooltip label="Visit counts arrive in a later update.">
            <span tabIndex={0} className="mut">—</span>
          </Tooltip>
        ) : (
          <b className="num">{f.conversion.toFixed(1)}%</b>
        ),
    },
    {
      key: 'active',
      header: 'Active',
      render: (f) => {
        if (f.archivedAt) return <Tag tone="warn">Archived</Tag>;
        if (!canEdit) return <Tag tone={f.isActive ? 'ok' : 'n'}>{f.isActive ? 'Active' : 'Off'}</Tag>;
        return (
          <label className="sw">
            <input type="checkbox" checked={f.isActive} aria-label={`Active: ${f.name}`} onChange={(e) => void toggleActive(f, e.target.checked)} />
            <span className="tg" />
          </label>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      right: true,
      render: (f) => {
        const archived = Boolean(f.archivedAt);
        const edit = <RowAction key="edit" verb="Edit" form={f} icon={<Pencil />} onClick={() => navigate(`/checkout-forms/${f.id}/edit`)} />;
        const actions = archived
          ? [edit, <RowAction key="restore" verb="Restore" form={f} icon={<ArchiveRestore />} disabled={busy} onClick={() => void restore(f)} />]
          : [
              <RowAction key="clone" verb="Clone" form={f} icon={<CopyPlus />} disabled={busy} onClick={() => void clone(f)} />,
              <RowAction key="preview" verb="Preview" form={f} icon={<Eye />} onClick={() => setPreviewing(f)} />,
              edit,
              <RowAction key="delete" verb="Delete" form={f} icon={<Trash2 />} danger disabled={busy} onClick={() => setDeleting(f)} />,
            ];
        // A manager reads the list: Preview (and the copy buttons) stay, everything that changes a form goes.
        return <div className="rowact">{canEdit ? actions : actions.filter((a) => a.key === 'preview')}</div>;
      },
    },
  ];

  const newForm = canEdit ? (
    <Button variant="primary" onClick={() => navigate('/checkout-forms/new')}>
      <Plus />
      New form
    </Button>
  ) : undefined;

  return (
    <section className="cforms">
      <div className="head">
        <div>
          <h1>Checkout forms</h1>
          <p>Each form is a page where customers pick a package and place an order.</p>
        </div>
        <div className="headtools">
          <label className="sw">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span className="tg" />
            Show archived
          </label>
          {newForm}
        </div>
      </div>

      <Card>
        {loading ? (
          <div style={{ padding: 20 }} aria-busy="true" aria-label="Loading checkout forms">
            <Skeleton height={44} />
            <Skeleton height={44} className="skelgap" />
            <Skeleton height={44} className="skelgap" />
          </div>
        ) : error ? (
          <EmptyState title={error} action={<Button onClick={() => void load(showArchived)}>Try again</Button>} />
        ) : forms.length === 0 ? (
          showArchived ? (
            <EmptyState title="No archived forms." text="A form with orders is archived instead of deleted. It will show here." />
          ) : (
            <EmptyState
              icon={<FileText aria-hidden="true" />}
              title="No checkout forms yet"
              text={canEdit ? 'Create your first form to start taking orders.' : 'The owner has not created a form yet.'}
              action={newForm}
            />
          )
        ) : (
          <Table label="Checkout forms" className="ct2" columns={columns} rows={forms} rowKey={(f) => f.id} />
        )}
        <div className="cfoot">
          <span>Clone copies fields, packages, upsells and design. The copy starts switched off.</span>
          <span>Conversion is orders divided by visits</span>
        </div>
      </Card>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        action="Delete"
        count={1}
        noun="form"
        title={deleting ? `Delete ${deleting.name}?` : undefined}
      >
        {deleting ? deleteText(deleting) : null}
      </ConfirmDialog>

      <PreviewModal form={previewing} onClose={() => setPreviewing(null)} />

      {manual && <CopyFallbackModal title={manual.title} text={manual.text} onClose={() => setManual(null)} />}
    </section>
  );
}
