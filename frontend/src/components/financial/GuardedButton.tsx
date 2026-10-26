import React from 'react';

interface GuardedButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** False when the user lacks the permission: the button is disabled and `reason` shows as a tooltip. */
  allowed: boolean;
  reason: string;
}

/** A button that stays visible but disabled, with a tooltip, when the user may not use it (F-939). */
export const GuardedButton: React.FC<GuardedButtonProps> = ({ allowed, reason, disabled, children, className, ...rest }) => (
  <span title={allowed ? undefined : reason} className="inline-flex">
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={!allowed || disabled}
      aria-disabled={!allowed || disabled}
      aria-label={!allowed && rest['aria-label'] ? `${rest['aria-label']} (${reason})` : rest['aria-label']}
      className={`${className ?? ''} ${!allowed ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  </span>
);
