import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';

interface CheckoutFormPreviewPaneProps {
  formId: number | null;
  /** Live draft to overlay on top of the saved form */
  draft: Record<string, any>;
  /** Debounce window for postMessage updates (ms) */
  debounceMs?: number;
}

type Device = 'desktop' | 'mobile';

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
  const [device, setDevice] = useState<Device>('desktop');

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

  if (formId === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-300 rounded-lg p-6 text-center">
        Save the form once to see a live preview here.
      </div>
    );
  }

  const src = `/checkout-forms/${formId}/preview`;
  const frameWidth = device === 'desktop' ? '100%' : '420px';

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Live preview
        </span>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            className={`p-1 rounded ${device === 'desktop' ? 'bg-gray-100' : 'text-gray-500'}`}
            title="Desktop"
            aria-pressed={device === 'desktop'}
          >
            <Monitor className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={`p-1 rounded ${device === 'mobile' ? 'bg-gray-100' : 'text-gray-500'}`}
            title="Mobile"
            aria-pressed={device === 'mobile'}
          >
            <Smartphone className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 bg-gray-100 rounded-lg overflow-hidden border border-gray-200 flex justify-center">
        <iframe
          ref={iframeRef}
          src={src}
          title="Checkout preview"
          className="bg-white"
          style={{ width: frameWidth, height: '100%', border: 0 }}
        />
      </div>
    </div>
  );
};
