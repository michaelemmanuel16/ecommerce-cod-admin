import { useState } from 'react';
import { useToast } from '../../../components/ui-v2';
import { downloadBlob } from '../../../utils/downloadBlob';
import { apiMessage } from '../../orders/importText';

/** Runs one export, saves its file, and says in a toast what happened. `busy` is true while it runs. */
export function useDownload() {
  const say = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (get: () => Promise<{ blob: Blob; filename: string }>, failText: string) => {
    setBusy(true);
    try {
      const { blob, filename } = await get();
      downloadBlob(blob, filename);
      say(`Downloaded ${filename}`);
    } catch (err) {
      say(await apiMessage(err, failText));
    } finally {
      setBusy(false);
    }
  };

  return { run, busy, say };
}
