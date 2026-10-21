import type { ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

type Variant = 'default' | 'primary' | 'danger';
// md = .btn, mini = .mini, icon = .ibtn (38px), icon-sm = .ibtn.sm (30px)
type Size = 'md' | 'mini' | 'icon' | 'icon-sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'default', size = 'md', type = 'button', className, ...rest }: ButtonProps) {
  const cls =
    size === 'md'
      ? clsx('btn', variant === 'primary' && 'pri', variant === 'danger' && 'danger')
      : size === 'mini'
        ? clsx('mini', variant === 'primary' && 'pri')
        : clsx('ibtn', size === 'icon-sm' && 'sm');
  return <button type={type} className={clsx(cls, className)} {...rest} />;
}
