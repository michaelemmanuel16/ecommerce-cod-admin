import { useV2Page } from '../components/shell/useV2Page';
import { CardsTab } from './connections/CardsTab';

/**
 * Connections (M9-T44, COD-82), built from docs/mockups/v2/connections.html: the cards for SMS, WhatsApp, Email, Paystack,
 * Meta Ads, checkout and the partner CSV. The Webhooks tab and the Activity log come with T45.
 */
export function Connections() {
  useV2Page();
  return (
    <section className="cx">
      <div className="head">
        <div><h1>Connections</h1><p>Messaging, payments, ads, your checkout and the keys your agents use.</p></div>
      </div>
      <CardsTab />
    </section>
  );
}
