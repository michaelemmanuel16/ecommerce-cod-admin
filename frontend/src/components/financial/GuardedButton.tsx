import React, { useId } from 'react';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../utils/cn';
import { FINANCE_PERMS, FinancePerm } from './financePerms';

type GuardedButtonProps = React.ComponentProps<typeof Button> & { perm: FinancePerm };

/**
 * A button that stays visible but disabled, with a tooltip, when the user lacks the permission (F-939).
 * A disabled button sends no mouse events, so it ignores the pointer and the tooltip's wrapper gets the hover.
 * The wrapper takes keyboard focus and describes itself with the reason for screen readers.
 */
export const GuardedButton: React.FC<GuardedButtonProps> = ({ perm, disabled, className, ...rest }) => {
  const { can } = usePermissions();
  const reasonId = useId();
  const { resource, action, reason } = FINANCE_PERMS[perm];
  if (can(resource, action)) return <Button {...rest} className={className} disabled={disabled} />;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} aria-describedby={reasonId} className="inline-flex">
        <Button {...rest} disabled tabIndex={-1} className={cn(className, 'pointer-events-none')} />
        <span id={reasonId} className="sr-only">{reason}</span>
      </span>
    </Tooltip>
  );
};
