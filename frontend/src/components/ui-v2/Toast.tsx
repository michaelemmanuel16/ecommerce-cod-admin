import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Portal } from './Portal';

const SHOW_MS = 2800; // shell.js: the toast hides after 2800 ms

/** The pill itself (.sx-toast). role="status" so a screen reader announces it. */
export function Toast({ message }: { message: string }) {
  return (
    <div className="sx-toast" role="status">
      {message}
    </div>
  );
}

type Say = (message: string) => void;
const ToastContext = createContext<Say | null>(null);

/** Mount once near the app root. `useToast()` returns `say(text)`; one toast shows at a time, the newest replaces the last. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const say = useCallback<Say>((text) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(null), SHOW_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={say}>
      {children}
      {message && (
        <Portal>
          <Toast message={message} />
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
