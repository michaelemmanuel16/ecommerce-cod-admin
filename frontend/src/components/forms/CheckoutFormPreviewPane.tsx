import React, { useEffect, useRef, useState } from 'react';
import { DeviceToggle, PreviewFrame } from './PreviewFrame';
import type { PreviewDevice } from '../../lib/previewWidth';

interface CheckoutFormPreviewPaneProps {
  formId: number | null;
  /** Live draft to overlay on top of the saved form */
  draft: Record<string, any>;
  /** Debounce window for postMessage updates (ms) */
  debounceMs?: number;
}

/**
 * Renders the admin preview route in an iframe and streams the editor's
 * current draft into the child via postMessage. The child page lives at
 * /checkout-forms/:id/preview and consumes the messages.
 */
export const CheckoutFormPreviewPane: React.FC<CheckoutFormPreviewPaneProps> = ({
  formId,
  draft,
  debounceMs = 150,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [childReady, setChildReady] = useState(false);
  // Increments on every ready ping so the draft-postMessage effect re-runs
  // and replays the current draft after an iframe reload — even when the
  // `childReady` boolean is already true. A boolean toggle inside a single
  // handler is batched by React and effectively a no-op.
  const [readyTick, setReadyTick] = useState(0);
  const [device, setDevice] = useState<PreviewDevice>('mobile');

  // Child handshake — when the preview page mounts it pings us; once we hear
  // the ping we know the message channel is live and we can stop dropping
  // updates. Origin-pinned so a co-resident cross-origin frame can't flip
  // childReady prematurely.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'checkout-preview-ready') {
        setChildReady(true);
        setReadyTick((n) => n + 1);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Debounced draft → postMessage. `readyTick` is in the dep array so each
  // fresh ready ping triggers a replay of the current draft.
  useEffect(() => {
    if (!childReady) return;
    const timer = setTimeout(() => {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      win.postMessage(
        { type: 'checkout-preview-update', patch: draft },
        window.location.origin
      );
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [draft, childReady, debounceMs, readyTick]);

  // In create mode (no saved id yet) we point at the bare create-preview route,
  // which renders entirely from the streamed draft.
  const src =
    formId === null
      ? '/checkout-forms/new/preview'
      : `/checkout-forms/${formId}/preview`;

  return (
    <div className="h-full flex flex-col">
      <div className="pvbar">
        <b>Live preview</b>
        <DeviceToggle device={device} onChange={setDevice} />
      </div>
      <div className="flex-1 min-h-0">
        <PreviewFrame ref={iframeRef} src={src} device={device} />
      </div>
    </div>
  );
};
