import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { DEFAULT_SUCCESS_TARGET, coveringTarget } from './leadership';

/** The delivery success target in percent: the tenant's setting covering `day`, else the default (60). Same read as the Deliveries page. */
export async function successTargetPct(tenantId: string, day: Date): Promise<number> {
  const target = await runInTenant(tenantId, () => coveringTarget(tenantId, 'delivery_success_rate', day));
  return target ? Money.parse(target.value).toNumber() : DEFAULT_SUCCESS_TARGET;
}
