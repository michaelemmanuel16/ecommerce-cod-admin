import React, { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { platformService } from '../services/platform.service';
import { BillingActivityTable, BillingEvent } from '../components/billing/BillingActivityTable';

/**
 * Platform billing activity (MAN-61, F3) — read-only list of recent platform
 * subscription webhook events across all tenants. Minimal money visibility; the
 * full renews-at / past-due / churn dashboard is the enforcement sibling.
 */
export const PlatformBilling: React.FC = () => {
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    platformService
      .listBillingEvents(100)
      .then((res) => setEvents(res.events))
      .catch(() => setError('Failed to load billing activity'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing Activity</h1>
        <p className="text-gray-500 mt-1">Recent subscription events across all tenants.</p>
      </div>

      <Card>
        <BillingActivityTable events={events} loading={loading} error={error} />
      </Card>
    </div>
  );
};
