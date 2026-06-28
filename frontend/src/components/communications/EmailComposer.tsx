import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Mail, Send, Settings, Eye, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { communicationService, EmailAudience, AudienceFilter } from '../../services/communication.service';
import { adminService } from '../../services/admin.service';
import { useProductsStore } from '../../stores/productsStore';
import { MergeTagToolbar } from './MergeTagToolbar';
import { SAMPLE_MERGE_VALUES } from './mergeTags';

// Prebuilt starting points (D-H3) — textarea + tokens, no rich-text builder.
const PREBUILT_TEMPLATES: { key: string; name: string; subject: string; body: string }[] = [
  {
    key: 'announcement',
    name: 'Announcement',
    subject: 'A quick update from {{store_name}}',
    body: '<p>Hi {{customer_name}},</p>\n<p>We have some news to share with you...</p>\n<p>Thanks,<br/>{{store_name}}</p>',
  },
  {
    key: 'promo',
    name: 'Promo / Sale',
    subject: '{{customer_name}}, a special offer inside',
    body: '<p>Hi {{customer_name}},</p>\n<p>For a limited time, enjoy a special offer from {{store_name}}.</p>\n<p><a href="#">Shop now</a></p>',
  },
  {
    key: 're-engage',
    name: 'Re-engagement',
    subject: 'We miss you, {{customer_name}}',
    body: '<p>Hi {{customer_name}},</p>\n<p>It has been a while — here is what is new at {{store_name}}.</p>',
  },
];

// Replace known merge tags with sample values for the live preview. Unknown tags
// are left as-is so the merchant can see exactly what they typed.
function renderPreview(text: string): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, tag) =>
    tag in SAMPLE_MERGE_VALUES ? SAMPLE_MERGE_VALUES[tag] : match,
  );
}

export const EmailComposer: React.FC = () => {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { products, fetchProducts } = useProductsStore();

  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [prebuilt, setPrebuilt] = useState('');

  const [stateFilter, setStateFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [hasOrdered, setHasOrdered] = useState(false);

  const [audience, setAudience] = useState<EmailAudience | null>(null);
  const [isLoadingAudience, setIsLoadingAudience] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');

  const currentFilter = useCallback((): AudienceFilter => {
    const f: AudienceFilter = {};
    if (stateFilter) f.state = stateFilter;
    if (productFilter) f.productId = Number(productFilter);
    if (hasOrdered) f.hasOrdered = true;
    return f;
  }, [stateFilter, productFilter, hasOrdered]);

  const loadAudience = useCallback(async () => {
    setIsLoadingAudience(true);
    try {
      setAudience(await communicationService.getEmailAudience(currentFilter()));
    } catch {
      toast.error('Failed to load audience');
    } finally {
      setIsLoadingAudience(false);
    }
  }, [currentFilter]);

  useEffect(() => {
    adminService
      .getSystemConfig()
      .then((cfg) => setProviderConfigured(!!cfg?.emailProvider?.fromEmail))
      .catch(() => setProviderConfigured(false));
    fetchProducts().catch(() => {});
    loadAudience();
    // Run once on mount; filter changes are applied via the explicit button.
  }, []);

  const insertTag = (token: string) => {
    const target = lastFocused.current === 'subject' ? subjectRef.current : bodyRef.current;
    const value = lastFocused.current === 'subject' ? subject : body;
    const setValue = lastFocused.current === 'subject' ? setSubject : setBody;
    if (!target) {
      setValue(value + token);
      return;
    }
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? value.length;
    setValue(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      target.focus();
      const caret = start + token.length;
      target.setSelectionRange(caret, caret);
    });
  };

  const applyPrebuilt = (key: string) => {
    setPrebuilt(key);
    const tpl = PREBUILT_TEMPLATES.find((t) => t.key === key);
    if (tpl) {
      setSubject(tpl.subject);
      setBody(tpl.body);
    }
  };

  const handleSend = async () => {
    if (!title.trim()) return toast.error('Give the campaign a name');
    if (!subject.trim()) return toast.error('Enter a subject');
    if (!body.trim()) return toast.error('Enter an email body');
    if (!audience || audience.emailable === 0) return toast.error('No emailable recipients in this audience');

    const confirmed = window.confirm(
      `Queue this campaign to ${audience.emailable} emailable customer${audience.emailable !== 1 ? 's' : ''}?`,
    );
    if (!confirmed) return;

    setIsSending(true);
    try {
      await communicationService.bulkSendEmail({
        title: title.trim(),
        subject: subject.trim(),
        htmlBody: body,
        filter: currentFilter(),
      });
      toast.success('Campaign queued — track it in Campaigns');
      setSearchParams({ tab: 'campaigns' }, { replace: true });
    } catch {
      toast.error('Failed to queue campaign');
    } finally {
      setIsSending(false);
    }
  };

  if (providerConfigured === null) {
    return <div className="py-12 text-center text-gray-500">Loading…</div>;
  }

  if (!providerConfigured) {
    return (
      <EmptyState
        icon={Mail}
        title="Email provider not configured"
        description="Connect your email provider before sending campaigns. Marketing email sends from your own domain to protect deliverability."
        action={
          <Button onClick={() => navigate('/settings?tab=integrations')}>
            <Settings className="w-4 h-4 mr-1" />
            Go to Settings → Email
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Campaign name */}
      <Card>
        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign name</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. June re-engagement"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <p className="text-xs text-gray-400 mt-1">Internal label — shown in Campaigns, not sent to customers.</p>
      </Card>

      {/* Message content */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">Message Content</h3>
          <select
            value={prebuilt}
            onChange={(e) => applyPrebuilt(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">— Start from template —</option>
            {PREBUILT_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Subject</label>
            <input
              ref={subjectRef}
              type="text"
              value={subject}
              onFocus={() => (lastFocused.current = 'subject')}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line — merge tags work here too"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-gray-600">Body (HTML)</label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                <Eye className="w-3.5 h-3.5" />
                {showPreview ? 'Hide preview' : 'Preview'}
              </button>
            </div>
            <textarea
              ref={bodyRef}
              value={body}
              onFocus={() => (lastFocused.current = 'body')}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Hi {{customer_name}}, ...</p>"
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
            />
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">Insert into the field you last clicked:</p>
            <MergeTagToolbar onInsert={insertTag} />
          </div>

          {showPreview && (
            <div className="border border-gray-200 rounded-md">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                Preview — sample recipient “{SAMPLE_MERGE_VALUES.customer_name}”
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-gray-800 mb-2">
                  {renderPreview(subject) || <span className="text-gray-400">(no subject)</span>}
                </p>
                {/* Sandboxed (no allow-scripts) so the merchant's own draft HTML
                    renders without any script ever executing. */}
                <iframe
                  title="Email preview"
                  sandbox=""
                  className="w-full h-64 border border-gray-100 rounded bg-white"
                  srcDoc={renderPreview(body)}
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Recipient filters */}
      <Card>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Audience</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">State / Region</label>
            <input
              type="text"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              placeholder="e.g. Greater Accra"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Product</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              checked={hasOrdered}
              onChange={(e) => setHasOrdered(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Has ordered before</span>
          </label>
          <Button size="sm" variant="outline" onClick={loadAudience} isLoading={isLoadingAudience}>
            Check Eligibility
          </Button>
        </div>

        {/* Eligibility transparency banner (D-CRIT) */}
        {audience && (
          <div className="mt-4 flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3">
            <Users className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-900">
              <span className="font-semibold">
                {audience.emailable} of {audience.audienceTotal}
              </span>{' '}
              customer{audience.audienceTotal !== 1 ? 's' : ''} can be emailed
              <span className="text-blue-700">
                {' '}({audience.noEmail} no address, {audience.optedOut} opted out)
              </span>
              .
              {audience.emailable === 0 && (
                <span className="block text-blue-700 mt-1">
                  Most COD customers have no email yet — this grows as your checkout collects addresses.
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Send */}
      <div className="flex justify-end">
        <Button onClick={handleSend} isLoading={isSending} disabled={!audience || audience.emailable === 0}>
          <Send className="w-4 h-4 mr-1" />
          Queue campaign{audience ? ` (${audience.emailable})` : ''}
        </Button>
      </div>
    </div>
  );
};
