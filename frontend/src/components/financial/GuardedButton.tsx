import React from 'react';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { usePermissions } from '../../hooks/usePermissions';
import { FINANCE_PERMS, FinancePerm } from './financePerms';

type GuardedButtonProps = React.ComponentProps<typeof Button> & { perm: FinancePerm };

/** A button that stays visible but disabled, with a tooltip, when the user lacks the permission (F-939). */
export const GuardedButton: React.FC<GuardedButtonProps> = ({ perm, disabled, ...rest }) => {
  const { can } = usePermissions();
  const { resource, action, reason } = FINANCE_PERMS[perm];
  if (can(resource, action)) return <Button {...rest} disabled={disabled} />;
  return (
    <Tooltip content={reason}>
      <Button {...rest} disabled aria-label={rest['aria-label'] ? `${rest['aria-label']} (${reason})` : undefined} />
    </Tooltip>
  );
};
