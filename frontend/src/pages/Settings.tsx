import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useV2Page } from '../components/shell/useV2Page';
import { Inbox } from 'lucide-react';
import { Button, Card } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { adminService, type SystemConfig } from '../services/admin.service';
import { useConfigStore } from '../stores/configStore';
import { UserManagementTable } from '../components/admin/UserManagementTable';
import { RolePermissionsMatrix } from '../components/admin/RolePermissionsMatrix';
import { IntegrationsPanel } from '../components/settings/IntegrationsPanel';
import { CurrenciesFxPanel } from '../components/settings/CurrenciesFxPanel';
import { LegacyCheckoutFormsPanel } from '../components/settings/LegacyCheckoutFormsPanel';
import { NoAccess } from './NoAccess';
import { ProfileTab } from './settings/ProfileTab';
import { SecurityTab } from './settings/SecurityTab';
import { BusinessTab } from './settings/BusinessTab';
import { StatusesTab } from './settings/StatusesTab';
import { BillingTab } from './settings/BillingTab';
import { SETTINGS_TABS, type SettingsTab, type TabDef } from './settings/tabs';

const KNOWN: SettingsTab[] = SETTINGS_TABS.map((t) => t.id);

/**
 * Old ?tab= names from the handover map (F-1237). "roles" is the old name of Role permissions. "forms" goes to the
 * Checkout forms page, which exists. User management, Role permissions and Integrations stay here until Staff (M6)
 * and Connections (M9) ship; their tabs keep their old content.
 */
const TAB_ALIASES: Record<string, SettingsTab> = { roles: 'permissions' };

/** The old Settings tabs keep their light look until each gets its new page (the shell does the same for old pages). */
function Old({ children }: { children: React.ReactNode }) {
  return <div className="setold legacy-light">{children}</div>;
}

/** What a person sees on a tab that the old page only let the owner open. */
function ViewOnly() {
  return (
    <Card>
      <p className="setnote">You can view this section but not change it. The owner opens it in full.</p>
    </Card>
  );
}

/** Notifications (F-1227): a pointer to Inbox settings. The button turns on when Inbox ships (M9). */
function NotificationsPointer() {
  return (
    <Card title="Notifications">
      <div className="linkcard">
        <span className="ico"><Inbox aria-hidden="true" /></span>
        <div>
          <b>Notification settings will live in Inbox</b>
          <p>Inbox is coming soon.</p>
        </div>
        <Button variant="primary" disabled>Open Inbox settings</Button>
      </div>
    </Card>
  );
}

/**
 * The Settings shell (M3-T63, F-1220): a section menu built from the person's permissions, and the open section
 * at the right. The section is in the URL (?tab=), so a link opens the same one. The owner tabs that have no new
 * home yet (User management, Role permissions, Integrations with the AI Assistant card, Checkout forms) keep their
 * old content here (F-1237), and so does Currencies and FX.
 */
export function Settings() {
  useV2Page();
  const [params, setParams] = useSearchParams();
  const { can, isSuperAdmin } = usePermissions();
  const access = { can, isSuperAdmin };

  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const loadSystemConfig = async () => {
    try {
      setSystemConfig(await adminService.getSystemConfig());
    } catch (error) {
      console.error('Failed to load system config:', error);
    }
  };
  // The old business and integrations tabs read the owner's system config; only the owner can fetch it
  useEffect(() => {
    if (isSuperAdmin) loadSystemConfig();
  }, [isSuperAdmin]);

  // OAuth callback goes to integrations; an unknown or removed ?tab= (for example "notifications") opens Profile
  const raw = params.has('oauth') ? 'integrations' : params.get('tab');
  const asked = raw && TAB_ALIASES[raw] ? TAB_ALIASES[raw] : raw;
  const tab: SettingsTab = KNOWN.includes(asked as SettingsTab) ? (asked as SettingsTab) : 'profile';
  // ?tab=forms: the Checkout forms page is the new home, so go there and keep the other parameters
  if (raw === 'forms') {
    const rest = new URLSearchParams(params);
    rest.delete('tab');
    const query = rest.toString();
    return <Navigate to={`/checkout-forms${query ? `?${query}` : ''}`} replace />;
  }
  const visible = SETTINGS_TABS.filter((t) => t.visible(access));
  const def = SETTINGS_TABS.find((t) => t.id === tab)!;
  const allowed = def.visible(access);

  const open = (id: SettingsTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    // The section param belongs to integrations only; oauth params are used up
    if (id !== 'integrations') next.delete('section');
    next.delete('oauth');
    next.delete('message');
    setParams(next, { replace: true });
  };

  const menuItem = (t: TabDef) => {
    const Icon = t.icon;
    return (
      <button key={t.id} type="button" className={`nav${t.id === tab ? ' on' : ''}`} aria-current={t.id === tab ? 'page' : undefined} onClick={() => open(t.id)}>
        <Icon aria-hidden="true" />
        {t.label}
      </button>
    );
  };
  const main = visible.filter((t) => t.group === 'main');
  const moving = visible.filter((t) => t.group === 'moving');

  const body = () => {
    switch (tab) {
      case 'profile': return <ProfileTab />;
      case 'security': return <SecurityTab />;
      case 'business': return isSuperAdmin ? <BusinessTab systemConfig={systemConfig} onSaved={loadSystemConfig} onOpenCurrencies={() => open('currencies')} /> : <ViewOnly />;
      case 'currencies':
        return isSuperAdmin ? (
          <Old>
            <CurrenciesFxPanel onStoreCurrencySaved={() => { loadSystemConfig(); useConfigStore.getState().fetchConfig(); }} />
          </Old>
        ) : <ViewOnly />;
      case 'statuses': return <StatusesTab />;
      case 'notifications': return <NotificationsPointer />;
      case 'billing': return <BillingTab />;
      case 'users': return <Old><UserManagementTable /></Old>;
      case 'permissions': return <Old><RolePermissionsMatrix /></Old>;
      case 'integrations': return <Old><IntegrationsPanel systemConfig={systemConfig} onConfigSaved={loadSystemConfig} /></Old>;
      case 'checkout-forms': return <Old><LegacyCheckoutFormsPanel /></Old>;
    }
  };

  return (
    <section>
      <div className="head">
        <div>
          <h1>Settings</h1>
          <p>Your profile, security and business settings.</p>
        </div>
      </div>

      <div className="setgrid">
        <nav className="card subnav" aria-label="Settings sections">
          {main.map(menuItem)}
          {moving.length > 0 && <p className="navlabel">Moving soon</p>}
          {moving.map(menuItem)}
        </nav>
        <div className="secs">
          {allowed ? body() : <NoAccess />}
        </div>
      </div>
    </section>
  );
}
