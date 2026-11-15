import { useSearchParams } from 'react-router-dom';
import { useV2Page } from '../components/shell/useV2Page';
import { Tabs } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { ActivityTab } from './connections/ActivityTab';
import { CardsTab } from './connections/CardsTab';
import { WebhooksTab } from './connections/WebhooksTab';

type TabId = 'connections' | 'webhooks' | 'activity';

/**
 * Connections (M9-T44, T45, COD-82), built from docs/mockups/v2/connections.html: the cards for SMS, WhatsApp, Email,
 * Paystack, Meta Ads, checkout and the partner CSV; the Webhooks tab; the Activity log. The tab is in the URL (?tab=).
 * Webhooks and Activity are for the owner and admins (their API routes are).
 */
export function Connections() {
  useV2Page();
  const [params, setParams] = useSearchParams();
  const { isAdmin } = usePermissions();

  const asked = params.get('tab');
  const tab: TabId = isAdmin && (asked === 'webhooks' || asked === 'activity') ? asked : 'connections';
  const open = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === 'connections') next.delete('tab'); else next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <section className="cx">
      <div className="head">
        <div><h1>Connections</h1><p>Messaging, payments, ads, your checkout and the keys your agents use.</p></div>
      </div>
      {isAdmin && (
        <Tabs
          label="Connections sections" value={tab} onChange={open} className="pgtabs"
          items={[{ id: 'connections', label: 'Connections' }, { id: 'webhooks', label: 'Webhooks' }, { id: 'activity', label: 'Activity' }]}
        />
      )}
      {tab === 'connections' && <CardsTab />}
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'activity' && <ActivityTab />}
    </section>
  );
}
