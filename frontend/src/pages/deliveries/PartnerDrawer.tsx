import { useCallback, useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, Drawer, Skeleton, Tabs, Tag, useToast } from '../../components/ui-v2';
import { AgentEditModal } from '../../components/admin/AgentEditModal';
import type { DeliveryAgent } from '../../services/delivery-agents.service';
import { deliveryPartnersService, type PartnerDetail, type PartnerRow } from '../../services/delivery-partners.service';
import { apiErrorMessage } from '../../utils/apiError';
import { DrawerFees } from './DrawerFees';
import { DrawerOrders } from './DrawerOrders';
import { DrawerSummary } from './DrawerSummary';
import { AvailabilitySwitch } from './AvailabilitySwitch';
import { rowTags, TYPE_LABEL, TYPE_TONE } from './model';

export type DrawerTab = 'summary' | 'orders' | 'fees';
const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'orders', label: 'Orders' },
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
  /** The tab to open on (a partner just added opens on Fees so setup can be finished, F-708). */
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
 * The partner drawer (M4-T32, F-707, F-711, F-713, F-709). Tabs Summary, Orders, Fees. "Edit person" opens the existing user edit.
 * A save on Fees writes an audit row on the server. The Stock tab comes with the stock APIs (COD-41).
 */
export function PartnerDrawer({ id, row, target, canEdit, canSwitch, startTab = 'summary', onClose, onChanged }: PartnerDrawerProps) {
  const say = useToast();
  const [tab, setTab] = useState<DrawerTab>('summary');
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
    setPartner(null);
    setFailed(null);
    setTab(startTab);
    void load();
    // startTab only matters when a partner opens
  }, [id, load]);

  const toggle = async (on: boolean) => {
    if (!partner) return;
    try {
      await deliveryPartnersService.setAvailability(partner.id, on);
      setPartner({ ...partner, isAvailable: on });
      onChanged();
      say(on ? `${partner.name} is available for new orders` : `${partner.name} is unavailable for new orders`);
    } catch (e) {
      say(apiErrorMessage(e, 'The availability could not be changed.'));
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
        <Tabs label="Partner details" items={TABS} value={tab} onChange={(t) => setTab(t as DrawerTab)} className="dtabs" />
        {failed ? (
          <p className="mut">{failed}</p>
        ) : !partner ? (
          <div aria-busy="true" aria-label="Loading partner"><Skeleton height={80} /><Skeleton height={80} className="skelgap" /></div>
        ) : tab === 'summary' ? (
          <DrawerSummary partner={partner} row={row} target={target} />
        ) : tab === 'orders' ? (
          <DrawerOrders partnerId={partner.id} />
        ) : (
          <DrawerFees partner={partner} canEdit={canEdit} onSaved={(p) => { setPartner(p); onChanged(); }} />
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
