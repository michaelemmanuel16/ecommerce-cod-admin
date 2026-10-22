import { MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui-v2';
import { canOpenPath } from '../../components/shell/navModel';
import { useAuthStore } from '../../stores/authStore';
import { isBlockError } from '../dashboard/types';
import { wholePercent } from './format';
import type { DeliveryReport } from './types';

/**
 * The agent card on top of Reports (F-1050): read-only, it writes nothing. It names the partner with the lowest delivery
 * success against the target, from the Delivery report's own partner rows. "Explain this month" needs the AI summary
 * (M11, F-1060) and is not on the page until then. No partner below target, or no closed orders: no card.
 */
export function AgentCards({ delivery, onOpenDelivery }: { delivery: DeliveryReport | null; onOpenDelivery: () => void }) {
  const { user, menu, homeRoute } = useAuthStore();
  if (!delivery || isBlockError(delivery.partners) || isBlockError(delivery.tiles)) return null;
  const target = delivery.tiles.deliverySuccessRate.target;
  const worst = delivery.partners.rows
    .filter((p) => p.successRate !== null && p.successRate < target)
    .sort((a, b) => (a.successRate as number) - (b.successRate as number))[0];
  if (!worst) return null;

  const timing = [
    worst.confirmedToDispatchedDays !== null && `${worst.name} takes ${worst.confirmedToDispatchedDays} days to dispatch`,
    worst.dispatchedToDeliveredDays !== null && `${worst.dispatchedToDeliveredDays} days to deliver`,
  ].filter(Boolean).join(' and ');

  return (
    <div className="grid agentrow">
      <div className="insight card">
        <div className="h">
          <div className="ico coral"><MapPin /></div>
          <div>
            <b>{worst.name} closes only {wholePercent(worst.successRate)} as delivered</b>
            <p>Target {target}%.{timing && ` ${timing}.`}</p>
          </div>
        </div>
        <div className="act">
          <Button size="mini" variant="primary" onClick={onOpenDelivery}>Open Delivery report</Button>
          {user && menu && canOpenPath('/delivery-agents', menu, user.role, homeRoute) && <Link className="mini" to="/delivery-agents">See partners</Link>}
        </div>
      </div>
    </div>
  );
}
