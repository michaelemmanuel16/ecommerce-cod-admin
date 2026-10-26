import type { ComponentProps } from 'react';
import { Button, Tooltip } from '../ui-v2';
import { usePermissions } from '../../hooks/usePermissions';
import type { Action, Resource } from '../../types';
import { FINANCE_PERMS, type FinancePerm } from './financePerms';

type GuardedButtonV2Props = ComponentProps<typeof Button> & { perm: FinancePerm };

/**
 * GuardedButton for the v2 screens (F-939): visible but inert, with the reason in a tooltip, when the user lacks the permission.
 * It uses aria-disabled, not disabled, so the button keeps keyboard focus and the tooltip and screen readers can give the reason.
 */
export function GuardedButtonV2({ perm, onClick, ...rest }: GuardedButtonV2Props) {
  const { can, user } = usePermissions();
  const { resource, action, reason }: { resource: Resource; action: Action; reason: string } = FINANCE_PERMS[perm];
  const roles: readonly string[] | undefined = (FINANCE_PERMS[perm] as { roles?: readonly string[] }).roles;
  if (can(resource, action) && (!roles || (!!user && roles.includes(user.role)))) return <Button {...rest} onClick={onClick} />;
  return (
    <Tooltip label={reason}>
      <Button {...rest} aria-disabled="true" onClick={(e) => e.preventDefault()} />
    </Tooltip>
  );
}
