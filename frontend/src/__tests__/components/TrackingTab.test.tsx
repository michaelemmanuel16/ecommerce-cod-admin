import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TrackingTab } from '../../components/forms/builder/TrackingTab';
import { checkoutFormsService } from '../../services/checkout-forms.service';
import { useAuthStore } from '../../stores/authStore';
import { CAPI_MASK } from '../../lib/trackingRules';
import { BuilderHarness, type HarnessOptions } from '../fixtures/builderHarness';

beforeEach(() => useAuthStore.setState({ user: { role: 'admin' } as never }));
afterEach(() => vi.restoreAllMocks());

const SAVED: HarnessOptions = {
  formId: 5,
  pixelConfig: { facebookPixelId: '482915073361842' },
  values: { metaCapiAccessToken: CAPI_MASK, metaCapiTestEventCode: 'TEST123' },
  ctx: { capiTokenStored: true, savedCapi: { pixelId: '482915073361842', testEventCode: 'TEST123' } },
};

const renderTab = (options: HarnessOptions = SAVED) =>
  render(
    <BuilderHarness options={options}>
      <TrackingTab />
    </BuilderHarness>,
  );

describe('TrackingTab ids (F-416)', () => {
  it('shows the server wording for a bad id, inline', () => {
    renderTab({ pixelConfig: { facebookPixelId: 'abc', googleAnalyticsId: 'UA-1', googleTagManagerId: 'X-1' } });
    expect(screen.getByText('Facebook Pixel ID must be digits only.')).toBeInTheDocument();
    expect(screen.getByText('Google Analytics ID must start with G-.')).toBeInTheDocument();
    expect(screen.getByText('Google Tag Manager ID must start with GTM-.')).toBeInTheDocument();
  });

  it('links to Connections, not to the old settings page', () => {
    renderTab();
    expect(screen.getByRole('link', { name: 'Connections' })).toHaveAttribute('href', '/connections');
  });
});

describe('TrackingTab write-only token', () => {
  it('shows Connected and never puts the token in the page', () => {
    const { container } = renderTab();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    // The harness prints the form values in a <pre>; the tab itself is the first block.
    expect((container.firstElementChild as HTMLElement).innerHTML).not.toContain(CAPI_MASK);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('Replace shows an empty password box; Cancel brings back Connected', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    const box = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(box).not.toBeNull();
    expect(box.value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('a form with no token shows the empty box and no Connected', () => {
    renderTab({ formId: 5 });
    expect(screen.queryByText('Connected')).toBeNull();
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
  });
});

describe('TrackingTab test event', () => {
  it('is off, with a hint, on a form that is not saved', () => {
    renderTab({ formId: null });
    expect(screen.getByRole('button', { name: 'Send a test event' })).toBeDisabled();
    expect(screen.getByText('Save the form first.')).toBeInTheDocument();
  });

  it('is off without a saved test event code', () => {
    renderTab({ ...SAVED, ctx: { capiTokenStored: true, savedCapi: { pixelId: '482915073361842', testEventCode: '' } }, values: { metaCapiAccessToken: CAPI_MASK, metaCapiTestEventCode: '' } });
    expect(screen.getByRole('button', { name: 'Send a test event' })).toBeDisabled();
    expect(screen.getByText('Add and save a test event code first.')).toBeInTheDocument();
  });

  it('is off for a manager', () => {
    useAuthStore.setState({ user: { role: 'manager' } as never });
    renderTab();
    expect(screen.getByRole('button', { name: 'Send a test event' })).toBeDisabled();
  });

  it('sends and shows the mocked Meta reply (status and body)', async () => {
    const send = vi.spyOn(checkoutFormsService, 'sendTestEvent').mockResolvedValue({ ok: true, status: 200, metaResponse: { events_received: 1 } });
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Send a test event' }));
    const box = await screen.findByTestId('test-event-result');
    expect(send).toHaveBeenCalledWith(5);
    expect(box).toHaveTextContent('Status 200');
    expect(box).toHaveTextContent('events_received');
  });

  it('says in plain words when the call fails', async () => {
    vi.spyOn(checkoutFormsService, 'sendTestEvent').mockRejectedValue(new Error('boom'));
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Send a test event' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The test event could not be sent'));
  });
});
