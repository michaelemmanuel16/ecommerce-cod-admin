import { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, Drawer, Tabs, Tag } from '../../components/ui-v2';
import { AgentEditModal } from '../../components/admin/AgentEditModal';
import type { DeliveryAgent } from '../../services/delivery-agents.service';
import { deliveryPartnersService, type PartnerDetail, type PartnerRow } from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';
import { DrawerFees } from './DrawerFees';
import { fieldsOf } from './feesFields';
import { DrawerOrders } from './DrawerOrders';
import { DrawerStock } from './DrawerStock';
import { ListSkeleton } from './ListSkeleton';
import { DrawerSummary } from './DrawerSummary';
import { AvailabilitySwitch } from './AvailabilitySwitch';
import { useAvailabilitySwitch } from './useAvailabilitySwitch';
import { rowTags, TYPE_LABEL, TYPE_TONE } from './model';

export type DrawerTab = 'summary' | 'orders' | 'stock' | 'fees';
const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'orders', label: 'Orders' },
  { id: 'stock', label: 'Stock' },
  { id: 'fees', label: 'Fees' },
];

interface PartnerDrawerProps {
  /** null: closed. */
  id: number | null;
  /** The table row of the period, when the partner is in the list. */
  row: PartnerRow | null;
  target: number;
  /** Owner and admin edit the profile and the person. */
  canEdit: boolean;
  /** Owner, admin and manager turn availability on and off. */
  canSwitch: boolean;
  /** The tab to open on (a partner just added opens on Fees so setup can be finished, F-708). Read when the drawer mounts; the page keys it by partner. */
  startTab?: DrawerTab;
  onClose: () => void;
  /** The partner changed (profile, person, availability): the page reloads its table. */
  onChanged: () => void;
}

/** The old edit modal wants the user shape of /api/admin/users. */
const agentOf = (p: PartnerDetail): DeliveryAgent => ({
  id: String(p.id), email: p.email, firstName: p.firstName, lastName: p.lastName, name: p.name, phoneNumber: p.phoneNumber ?? '',
  role: 'delivery_agent', isActive: p.isActive, isAvailable: p.isAvailable, vehicleType: p.vehicleType ?? undefined, vehicleId: p.vehicleId ?? undefined,
  createdAt: '',
});

/**
 * The partner drawer (M4-T32, F-707, F-711, F-713, F-709). Tabs Summary, Orders, Stock, Fees. "Edit person" opens the existing user edit.
 * A save on Fees writes an audit row on the server. The page gives the drawer a `key` per partner, so each partner starts clean.
 */
export function PartnerDrawer({ id, row, target, canEdit, canSwitch, startTab = 'summary', onClose, onChanged }: PartnerDrawerProps) {
  const switchAvailability = useAvailabilitySwitch();
  const [tab, setTab] = useState<DrawerTab>(startTab);
  /** The Orders tab stays mounted once opened, so its rows and filter are still there when the user comes back. */
  const [ordersOpened, setOrdersOpened] = useState(startTab === 'orders');
  const [partner, setPartner] = useState<PartnerDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (id === null) return;
    try {
      setPartner(await deliveryPartnersService.get(id));
      setFailed(null);
    } catch (e) {
      setFailed(apiErrorMessage(e, 'The partner could not load.'));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (on: boolean) => {
    if (!partner) return;
    if (await switchAvailability(partner, on)) {
      setPartner({ ...partner, isAvailable: on });
      onChanged();
    }
  };

  const tags = partner ? [{ tone: TYPE_TONE[partner.type], text: TYPE_LABEL[partner.type] }, ...rowTags({ isActive: partner.isActive, isAvailable: partner.isAvailable, isTrial: partner.profile.isTrial })] : [];

  return (
    <>
      <Drawer
        open={id !== null}
        onClose={onClose}
        title={partner?.name ?? 'Delivery partner'}
        description={partner ? <span className="dtags">{tags.map((t) => <Tag key={t.text} tone={t.tone}>{t.text}</Tag>)}</span> : undefined}
        headerExtra={
          partner && (
            <div className="dhead">
              {canSwitch && partner.isActive && <AvailabilitySwitch name={partner.name} checked={partner.isAvailable} onChange={(on) => void toggle(on)} />}
              {canEdit && (
                <Button size="mini" onClick={() => setEditing(true)}>
                  <Pencil style={{ width: 13, height: 13 }} />
                  Edit person
                </Button>
              )}
            </div>
          )
        }
      >
        <Tabs label="Partner details" items={TABS} value={tab} onChange={(t) => {
          setTab(t as DrawerTab);
          if (t === 'orders') setOrdersOpened(true);
        }} className="dtabs" />
        {failed ? (
          <p className="mut">{failed}</p>
        ) : !partner ? (
          <ListSkeleton label="Loading partner" height={80} />
        ) : (
          <>
            {tab === 'summary' && <DrawerSummary partner={partner} row={row} target={target} />}
            {ordersOpened && <div hidden={tab !== 'orders'}><DrawerOrders partnerId={partner.id} /></div>}
            {tab === 'stock' && <DrawerStock location={partner.stockLocation} />}
            {tab === 'fees' && <DrawerFees key={JSON.stringify(fieldsOf(partner))} partner={partner} canEdit={canEdit} onSaved={(p) => { setPartner(p); onChanged(); }} onRulesChanged={onChanged} />}
          </>
        )}
      </Drawer>
      {editing && partner && (
        <AgentEditModal
          isOpen
          agent={agentOf(partner)}
          onClose={() => {
            setEditing(false);
            void load();
            onChanged();
          }}
        />
      )}
    </>
  );
}
