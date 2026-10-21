import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/** Layers (Modal, Drawer, Toast) render under <body>. The `.v2` wrapper keeps the tokens and font scope. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(<div className="v2">{children}</div>, document.body);
}
