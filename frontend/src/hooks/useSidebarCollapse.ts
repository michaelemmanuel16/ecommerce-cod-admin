import { useState, useEffect, useRef } from 'react';

export function useSidebarCollapse(storageKey: string): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) : false;
  });

  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(isCollapsed));
  }, [isCollapsed, storageKey]);

  return [isCollapsed, setIsCollapsed];
}
