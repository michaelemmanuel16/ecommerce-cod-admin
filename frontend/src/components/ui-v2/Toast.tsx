import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Portal } from './Portal';

const SHOW_MS = 2800; // shell.js: the toast hides after 2800 ms
const SHOW_ACTION_MS = 8000; // a toast with a link stays long enough to reach it

/** A link at the end of a toast, for example "Show the 2". */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** The pill itself (.sx-toast). role="status" so a screen reader announces it. */
export function Toast({ message, action, onAction }: { message: string; action?: string; onAction?: () => void }) {
  return (
    <div className="sx-toast" role="status">
      {message}
      {action && (
        <button type="button" className="sx-act-link" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

type Say = (message: string, action?: ToastAction) => void;
const ToastContext = createContext<Say | null>(null);

/** Mount once near the app root. `useToast()` returns `say(text)`; one toast shows at a time, the newest replaces the last. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ message: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const say = useCallback<Say>((text, action) => {
    clearTimeout(timer.current);
    setShown({ message: text, action });
    timer.current = setTimeout(() => setShown(null), action ? SHOW_ACTION_MS : SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={say}>
      {children}
      {shown && (
        <Portal>
          <Toast
            message={shown.message}
            action={shown.action?.label}
            onAction={() => {
              shown.action?.onClick();
              setShown(null);
            }}
          />
        </Portal>
      )}
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): Say {
  const say = useContext(ToastContext);
  if (!say) throw new Error('useToast needs a ToastProvider');
  return say;
}
