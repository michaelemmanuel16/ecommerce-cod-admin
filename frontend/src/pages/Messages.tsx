import { useSearchParams } from 'react-router-dom';
import { useV2Page } from '../components/shell/useV2Page';
import { Tabs } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { ConversationsTab } from './messages/ConversationsTab';
import { TABS, type TabKey } from './messages/tabs';

/**
 * Messages (M9-T30, F-454), built from docs/mockups/v2/messages.html: every message sent to customers and what they
 * send back. The page does no arithmetic: every figure and status comes from the API. Templates and Opt-outs are the next
 * wave; the agent cards and Scheduled of the mockup have no backend yet and are left out.
 */
export function Messages() {
  useV2Page();
  const { user, can, isManager } = usePermissions();
  const [search, setSearch] = useSearchParams();
  const tab: TabKey = TABS.find((t) => t.key === search.get('tab'))?.key ?? TABS[0].key;

  const open = (key: TabKey) => setSearch((prev) => { const next = new URLSearchParams(prev); next.set('tab', key); return next; }, { replace: true });

  return (
    <section className="msgs-page">
      <div className="head">
        <div>
          <h1>Messages</h1>
          <p>Every message you send customers, and what they send back.</p>
        </div>
      </div>

      <Tabs
        className="pgtabs" label="Messages" value={tab} onChange={(id) => open(id as TabKey)}
        items={TABS.map((t) => ({ id: t.key, label: <><t.icon />{t.label}</> }))}
      />

      {tab === 'conversations' && (
        <div className="card inboxcard">
          <ConversationsTab meId={user?.id ?? null} canWrite={can('messages', 'create')} canPickPeople={isManager} />
        </div>
      )}
    </section>
  );
}
