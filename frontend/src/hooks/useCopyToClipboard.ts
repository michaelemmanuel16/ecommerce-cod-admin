import { useCallback, useEffect, useRef, useState } from 'react';

const COPIED_FEEDBACK_MS = 2000;

/** Writes to the clipboard. false when the browser refuses (no permission, insecure page): the caller then shows the text. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    return false;
  }
}

export const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    if (!(await copyText(text))) return;
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, []);

  return { copied, copy };
};
