import { ChevronDown, Copy } from 'lucide-react';
import { Button } from '../../components/ui-v2';
import { usePopover } from '../../components/shell/usePopover';
import { buildWidgetSnippet, formUrl } from '../../lib/embedSnippet';
import type { CheckoutForm } from '../../types/checkout-form';

export type CopyText = (text: string, done: string, title: string) => void;

/**
 * The Link column (F-410): "/form/<slug>", a copy button, and a small menu with the link, the embed code and, for a form
 * with packages, one link per package (`?package=<id>`, the link that opens the form locked to that package).
 */
export function LinkCell({ form, copy }: { form: CheckoutForm; copy: CopyText }) {
  const { open, toggle, close, wrapRef, triggerRef } = usePopover();
  const link = formUrl(form.slug);
  const copyLink = { label: 'Copy link', text: link, done: 'Link copied.' };
  const items = [
    copyLink,
    { label: 'Copy embed code', text: buildWidgetSnippet(form), done: 'Embed code copied.' },
    ...(form.packages ?? [])
      .filter((p) => p.id > 0)
      .map((p) => ({ label: `Copy link: ${p.name}`, text: `${link}?package=${p.id}`, done: 'Link copied.' })),
  ];

  return (
    <span className="lnkcell popwrap" ref={wrapRef}>
      <span>/form/{form.slug}</span>
      <Button size="icon-sm" aria-label={`Copy link for ${form.name}`} title={copyLink.label} onClick={() => copy(copyLink.text, copyLink.done, copyLink.label)}>
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
          {items.map((item, i) => (
            <button
              key={`${i}-${item.label}`}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                copy(item.text, item.done, item.label);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
