import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Card title (.ct h3). Leave out for a bare card. */
  title?: ReactNode;
  /** Small grey text at the right of the title row (.ct span). */
  aside?: ReactNode;
}

export function Card({ title, aside, className, children, ...rest }: CardProps) {
  return (
    <div className={clsx('card', className)} {...rest}>
      {(title || aside) && (
        <div className="ct">
          <h3>{title}</h3>
          {aside && <span>{aside}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
