import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useV2Page } from '../components/shell/useV2Page';
import { Card } from '../components/ui-v2';
import { usePermissions } from '../hooks/usePermissions';
import { adminService, type SystemConfig } from '../services/admin.service';
import { useConfigStore } from '../stores/configStore';
import { UserManagementTable } from '../components/admin/UserManagementTable';
import { RolePermissionsMatrix } from '../components/admin/RolePermissionsMatrix';
import { IntegrationsPanel } from '../components/settings/IntegrationsPanel';
import { CurrenciesFxPanel } from '../components/settings/CurrenciesFxPanel';
import { LegacyBusinessPanel } from '../components/settings/LegacyBusinessPanel';
import { LegacyCheckoutFormsPanel } from '../components/settings/LegacyCheckoutFormsPanel';
import { Billing } from './Billing';
import { NoAccess } from './NoAccess';
import { ProfileTab } from './settings/ProfileTab';
import { SecurityTab } from './settings/SecurityTab';
import { SETTINGS_TABS, type SettingsTab, type TabDef } from './settings/tabs';

const KNOWN: SettingsTab[] = SETTINGS_TABS.map((t) => t.id);

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

/**
 * The Settings shell (M3-T63, F-1220): a section menu built from the person's permissions, and the open section
 * at the right. The section is in the URL (?tab=), so a link opens the same one. Business details, Currencies and
 * FX, Billing and the old owner tabs show their old content here until M3-T65 and M3-T66 replace it.
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
  const asked = params.has('oauth') ? 'integrations' : params.get('tab');
  const tab: SettingsTab = KNOWN.includes(asked as SettingsTab) ? (asked as SettingsTab) : 'profile';
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
      case 'business': return isSuperAdmin ? <Old><LegacyBusinessPanel systemConfig={systemConfig} onSaved={loadSystemConfig} /></Old> : <ViewOnly />;
      case 'currencies':
        return isSuperAdmin ? (
          <Old>
            <CurrenciesFxPanel onStoreCurrencySaved={() => { loadSystemConfig(); useConfigStore.getState().fetchConfig(); }} />
          </Old>
        ) : <ViewOnly />;
      case 'billing': return <Old><Billing /></Old>;
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
