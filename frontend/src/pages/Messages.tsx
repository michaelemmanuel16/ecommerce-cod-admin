import { useSearchParams } from 'react-router-dom';
import { useV2Page } from '../components/shell/useV2Page';
import { Tabs } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { BulkSendTab } from './messages/BulkSendTab';
import { CampaignsTab } from './messages/CampaignsTab';
import { ConversationsTab } from './messages/ConversationsTab';
import { LogTab } from './messages/LogTab';
import { OverviewTab } from './messages/OverviewTab';
import { TemplatesTab } from './messages/TemplatesTab';
import { TABS, type TabKey } from './messages/tabs';

/**
 * Messages (M9-T30, F-454), built from docs/mockups/v2/messages.html: every message sent to customers and what they
 * send back. The page does no arithmetic: every figure and status comes from the API. Overview and Message log (M9-T31) read the same API definition, so a tile equals the log rows behind it. Bulk send and Campaigns are the old tabs moved over (no email composer). Templates (M9-T34) read and write the
 * message-templates API; Opt-outs come next; the agent cards and Scheduled of the mockup have no backend yet and are left out.
 */
export function Messages() {
  useV2Page();
  const { user, can, isManager, isAdmin } = usePermissions();
  const [search, setSearch] = useSearchParams();
  // Bulk send is the API's owner and admin only, and needs messages:create
  const tabs = TABS.filter((t) => (t.key !== 'bulk' || (isAdmin && can('messages', 'create'))) && (t.key !== 'templates' || isManager));
  const tab: TabKey = tabs.find((t) => t.key === search.get('tab'))?.key ?? tabs[0].key;

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
        items={tabs.map((t) => ({ id: t.key, label: <><t.icon />{t.label}</> }))}
      />

      {tab === 'overview' && (
        <OverviewTab logHref={(figure, range, channel) => `/messages?tab=log&status=${figure}&range=${range}${channel ? `&channel=${channel}` : ''}`} />
      )}
      {tab === 'log' && <div className="card"><LogTab /></div>}
      {tab === 'bulk' && <div className="card"><BulkSendTab /></div>}
      {tab === 'campaigns' && <div className="card"><CampaignsTab /></div>}
      {tab === 'templates' && <div className="card"><TemplatesTab canWrite={isAdmin} /></div>}
      {tab === 'conversations' && (
        <div className="card inboxcard">
          <ConversationsTab meId={user?.id ?? null} canWrite={can('messages', 'create')} canPickPeople={isManager} />
        </div>
      )}
    </section>
  );
}
