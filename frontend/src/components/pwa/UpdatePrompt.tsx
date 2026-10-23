import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../ui-v2';
import { Portal } from '../ui-v2/Portal';

/** "A new version is available" toast (F-109). Stays until the person updates; the service worker then reloads the page. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <Portal>
      <div className="sx-toast update" role="status">
        <span>A new version is available.</span>
        <Button size="mini" onClick={() => updateServiceWorker(true)}>Update</Button>
      </div>
    </Portal>
  );
}
