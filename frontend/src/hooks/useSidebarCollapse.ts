import { useState, useEffect, useRef } from 'react';

// localStorage can throw (private window, blocked site data): then the sidebar opens expanded and the page still works (F-101).
export function useSidebarCollapse(storageKey: string): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) === true : false;
    } catch {
      return false;
    }
  });

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(isCollapsed));
    } catch {
      // not saved; the state lasts until reload
    }
  }, [isCollapsed, storageKey]);

  return [isCollapsed, setIsCollapsed];
}
