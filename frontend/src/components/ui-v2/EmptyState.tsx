import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** A lucide icon element. */
  icon?: ReactNode;
  title: string;
  text?: string;
  /** Optional call to action, for example a <Button>. */
  action?: ReactNode;
}

/** .empty: centred icon, bold title, one grey line, optional button. */
export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {icon}
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
