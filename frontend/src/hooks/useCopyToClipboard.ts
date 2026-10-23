import { useCallback, useEffect, useRef, useState } from 'react';

const COPIED_FEEDBACK_MS = 2000;

export const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  }, []);

  return { copied, copy };
};
