import { ChevronDown, Copy } from 'lucide-react';
import { Button } from '../../components/ui-v2';
import { usePopover } from '../../components/shell/usePopover';
import { buildWidgetSnippet, formUrl } from '../../lib/embedSnippet';
import type { CheckoutForm } from '../../types/checkout-form';

export type CopyText = (text: string, done: string, title: string) => void;

/**
 * The Link column (F-410): "/form/<slug>", a copy button, and a small menu with the embed code and, for a form with
 * packages, one link per package (`?package=<id>`, the link that opens the form locked to that package).
 */
export function LinkCell({ form, copy }: { form: CheckoutForm; copy: CopyText }) {
  const { open, toggle, close, wrapRef, triggerRef } = usePopover();
  const packages = (form.packages ?? []).filter((p) => p.id > 0);
  const link = formUrl(form.slug);

  const pick = (text: string, done: string, title: string) => {
    close();
    copy(text, done, title);
  };

  return (
    <span className="lnkcell popwrap" ref={wrapRef}>
      <span>/form/{form.slug}</span>
      <Button size="icon-sm" aria-label={`Copy link for ${form.name}`} title="Copy link" onClick={() => copy(link, 'Link copied.', 'Copy link')}>
        <Copy />
      </Button>
      <button
        type="button"
        ref={triggerRef}
        className="ibtn sm"
        aria-label={`More copy options for ${form.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <ChevronDown />
      </button>
      {open && (
        <div className="sx-menu lnkmenu" role="menu">
          <button type="button" role="menuitem" onClick={() => pick(link, 'Link copied.', 'Copy link')}>
            Copy link
          </button>
          <button type="button" role="menuitem" onClick={() => pick(buildWidgetSnippet(form), 'Embed code copied.', 'Copy embed code')}>
            Copy embed code
          </button>
          {packages.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => pick(`${link}?package=${p.id}`, 'Link copied.', `Copy link for ${p.name}`)}
            >
              Copy link: {p.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
