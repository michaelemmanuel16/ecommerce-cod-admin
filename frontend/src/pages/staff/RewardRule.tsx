import { Link } from 'react-router-dom';
import { Skeleton } from '../../components/ui-v2';
import type { RoleCard } from '../../services/roles.service';
import { targetsService } from '../../services/targets.service';
import { wholeMoney } from '../dashboard/format';
import { useBlock } from '../financial/profit/useBlock';
import { cashTiers } from './roleModel';

/**
 * "Reward rule" of the role detail (M6-T21, F-1151): the cash tiers of Settings, Rewards for this role, read only. A person who may
 * not read Settings sees the block without the figures. "Edit rule" opens the Rewards tab.
 */
export function RewardRule({ role }: { role: RoleCard }) {
  const settings = useBlock('rewards/settings', () => targetsService.rewardSettings().catch(() => null));
  const tiers = settings.data ? cashTiers(settings.data.tiers.find((t) => t.roleId === role.id)) : [];
  return (
    <div className="dsec">
      <h4><span>Reward rule</span><Link className="mini" to="/settings?tab=rewards">Edit rule</Link></h4>
      <div className="dbox">
        {settings.status === 'loading' ? <Skeleton height={36} /> : settings.data === null || settings.data === undefined ? (
          <small>The reward rule needs Settings access.</small>
        ) : tiers.length === 0 ? (
          <small>No cash reward for this role.</small>
        ) : (
          <>
            {tiers.map((t) => (
              <div className="tier" key={t.key}><span className="tag ok">{t.key}%</span><span>of target</span><b>{wholeMoney(t.amount, settings.data!.currency)}</b></div>
            ))}
            <small className="dsub">Read from Settings, Rewards.</small>
          </>
        )}
      </div>
    </div>
  );
}
