import React, { useState } from 'react';
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
}

export const Tabs: React.FC<TabsProps> = ({ tabs, defaultTab, persistKey }) => {
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

  const activeTabDef = tabs.find((tab) => tab.id === activeTab);
  const activeContent = typeof activeTabDef?.content === 'function' ? activeTabDef.content() : activeTabDef?.content;

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
                'py-4 px-1 border-b-2 font-medium text-sm',
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
