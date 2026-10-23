import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Tag } from '../../ui-v2';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { checkoutFormsService, type TestEventResult } from '../../../services/checkout-forms.service';
import { CAPI_MASK, trackingIdError } from '../../../lib/trackingRules';
import { useAuthStore } from '../../../stores/authStore';
import { apiErrorMessage } from '../../../utils/apiError';
import type { PixelConfig } from '../../../types/checkout-form';

const MAX_REPLY = 300;

/** Meta's reply as a short line: the status and the start of the body. */
const replyText = (r: TestEventResult): string => {
  const body = typeof r.metaResponse === 'string' ? r.metaResponse : JSON.stringify(r.metaResponse ?? {});
  return body.length > MAX_REPLY ? `${body.slice(0, MAX_REPLY)}…` : body;
};

/**
 * Tracking tab (M3b-T13, F-416): pixel and Conversion API settings, per form. The token is write-only: the page shows
 * "Connected" and a Replace button and never holds the saved token in an input.
 */
export const TrackingTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const role = useAuthStore((s) => s.user?.role);
  const canTest = role === 'super_admin' || role === 'admin';
  const [result, setResult] = useState<TestEventResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const token = ctx.watch('metaCapiAccessToken') ?? '';
  const testCode = ctx.watch('metaCapiTestEventCode') ?? '';
  const pixelId = ctx.pixelConfig.facebookPixelId ?? '';
  const connected = ctx.capiTokenStored && token === CAPI_MASK;
  const replacing = ctx.capiTokenStored && token !== CAPI_MASK;

  const setId = (key: keyof PixelConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    ctx.setPixelConfig((p) => ({ ...p, [key]: e.target.value.trim() || undefined }));
  const idField = (key: keyof PixelConfig, label: string, placeholder: string) => (
    <Input
      label={label}
      value={ctx.pixelConfig[key] ?? ''}
      onChange={setId(key)}
      placeholder={placeholder}
      error={trackingIdError(key, ctx.pixelConfig[key]) ?? undefined}
    />
  );

  // The test event uses what is saved, so it needs a saved form, a saved token and test code, and no unsaved edit to them.
  let blockedBy: string | null = null;
  if (ctx.formId === null) blockedBy = 'Save the form first.';
  else if (!ctx.capiTokenStored || replacing) blockedBy = ctx.capiTokenStored ? 'Save the new token first.' : 'Add and save a Conversion API token first.';
  else if (!ctx.savedCapi.testEventCode) blockedBy = 'Add and save a test event code first.';
  else if (!ctx.savedCapi.pixelId) blockedBy = 'Add and save a Facebook Pixel ID first.';
  else if (testCode.trim() !== ctx.savedCapi.testEventCode || pixelId !== ctx.savedCapi.pixelId) blockedBy = 'Save your changes first.';
  else if (!canTest) blockedBy = 'Only the owner or an admin can send a test event.';

  const send = async () => {
    if (ctx.formId === null) return;
    setSending(true);
    setResult(null);
    setFailure(null);
    try {
      setResult(await checkoutFormsService.sendTestEvent(ctx.formId));
    } catch (e) {
      setFailure(apiErrorMessage(e, 'The test event could not be sent. Try again in a moment.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Tracking</h3>
        <p>
          Send order events to your ad platforms. Meta gets both the browser pixel and the server event, so in-app browsers still count.
          Payment and store connections are in <Link to="/connections">Connections</Link>.
        </p>
      </div>

      <div className="row2">
        {idField('facebookPixelId', 'Facebook Pixel ID', 'e.g. 482915073361842')}
        {idField('googleAnalyticsId', 'Google Analytics 4 ID', 'G-XXXXXXXXXX')}
      </div>

      <div className="fl">
        <label htmlFor="cf-capi-token">Meta Conversions API access token</label>
        {connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag tone="ok">Connected</Tag>
            <Button size="mini" onClick={() => ctx.setValue('metaCapiAccessToken', '', { shouldDirty: true })}>Replace</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="cf-capi-token"
              type="password"
              autoComplete="off"
              placeholder="Paste your Meta Conversions API access token"
              value={token}
              onChange={(e) => ctx.setValue('metaCapiAccessToken', e.target.value, { shouldDirty: true })}
            />
            {replacing && (
              <Button size="mini" onClick={() => ctx.setValue('metaCapiAccessToken', CAPI_MASK, { shouldDirty: true })}>Cancel</Button>
            )}
          </div>
        )}
        <p className="hint">
          Browser and server events are matched, so orders are not counted twice. The saved token is never shown again.
          {replacing && ' Save with this field empty to remove the token.'}
        </p>
      </div>

      <div className="row2">
        <Input
          label="Meta test event code"
          value={testCode}
          onChange={(e) => ctx.setValue('metaCapiTestEventCode', e.target.value, { shouldDirty: true })}
          placeholder="TEST12345"
          hint="For testing only. Clear it before you run ads."
        />
        {idField('tiktokPixelId', 'TikTok Pixel ID', 'C4XXXXXXXXXXXX')}
      </div>
      <div style={{ maxWidth: 300 }}>{idField('googleTagManagerId', 'Google Tag Manager ID', 'GTM-XXXXXXX')}</div>

      <div className="stack" style={{ gap: 8 }}>
        <div>
          <Button disabled={blockedBy !== null || sending} onClick={send}>
            {sending ? 'Sending…' : 'Send a test event'}
          </Button>
          {blockedBy && <p className="hint">{blockedBy}</p>}
        </div>
        {result && (
          <div className={`testbox ${result.ok ? 'ok' : 'bad'}`} role="status" data-testid="test-event-result">
            <b>{result.ok ? 'Meta accepted the test event.' : 'Meta did not accept the test event.'}</b> Status {result.status}.
            <pre>{replyText(result)}</pre>
          </div>
        )}
        {failure && <p className="err" role="alert">{failure}</p>}
      </div>
    </div>
  );
};
