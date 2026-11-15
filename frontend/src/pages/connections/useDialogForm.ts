import { useEffect, useState } from 'react';

export type TestNote = { ok: boolean; text: string } | null;

/** The state every connection dialog shares: saving, testing, the error line and the test result. They clear each time the dialog opens or its source changes. */
export function useDialogForm(open: boolean, source: unknown) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<TestNote>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTestNote(null);
  }, [open, source]);

  return { saving, setSaving, testing, setTesting, error, setError, testNote, setTestNote };
}
