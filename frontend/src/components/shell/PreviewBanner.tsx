import { Eye } from 'lucide-react';
import { usePreviewStore } from '../../stores/previewStore';
import { Button } from '../ui-v2';

/** Preview mode banner (F-103): "Preview as <name>". Changes are blocked while it shows. */
export function PreviewBanner() {
  const asName = usePreviewStore((s) => s.asName);
  const stop = usePreviewStore((s) => s.stop);
  if (asName === null) return null;
  return (
    <div className="banner plan" role="status">
      <span><Eye aria-hidden="true" /> Preview as {asName}. You can look around. Changes are not saved.</span>
      <Button size="mini" variant="primary" onClick={stop}>Exit preview</Button>
    </div>
  );
}
