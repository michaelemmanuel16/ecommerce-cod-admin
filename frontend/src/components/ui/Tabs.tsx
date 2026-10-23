import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../../utils/cn';

interface Tab {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode | (() => React.ReactNode);
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  /** When set, persists the active tab in URL search params under this key */
  persistKey?: string;
  /** Closer tabs in the v2 colours that scroll sideways when they still do not fit (the form editor has seven in a narrow column). */
  compact?: boolean;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTab, persistKey, compact }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabIds = tabs.map(t => t.id);

  const getInitial = () => {
    if (persistKey) {
      const param = searchParams.get(persistKey);
      if (param && tabIds.includes(param)) return param;
    }
    return defaultTab || tabs[0]?.id;
  };

  const [activeTab, setActiveTabState] = useState(getInitial);

  const setActiveTab = (tabId: string) => {
    setActiveTabState(tabId);
    if (persistKey) {
      const params = new URLSearchParams(searchParams);
      params.set(persistKey, tabId);
      setSearchParams(params, { replace: true });
    }
  };

  // Compact strip (the form editor): token colours, scrolls sideways when the tabs do not fit, shows a fade on the side
  // that has more, and keeps the active tab in view.
  const navRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const next = { left: nav.scrollLeft > 2, right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2 };
    setMore((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);
  useEffect(() => {
    if (!compact) return;
    const nav = navRef.current;
    if (!nav) return;
    measure();
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && active.offsetLeft + active.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = active.offsetLeft + active.offsetWidth - nav.clientWidth;
    else if (active && active.offsetLeft < nav.scrollLeft) nav.scrollLeft = active.offsetLeft;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [compact, activeTab, measure]);

  const activeTabDef = tabs.find((tab) => tab.id === activeTab);
  const activeContent = typeof activeTabDef?.content === 'function' ? activeTabDef.content() : activeTabDef?.content;

  if (compact) {
    return (
      <div>
        <nav
          ref={navRef}
          className="etabs"
          aria-label="Form sections"
          data-more-left={more.left || undefined}
          data-more-right={more.right || undefined}
          onScroll={measure}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn('etab', activeTab === tab.id && 'on')}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="py-4" key={activeTab}>{activeContent}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="py-4" key={activeTab}>{activeContent}</div>
    </div>
  );
};
