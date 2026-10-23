import type { HTMLAttributes } from 'react';
import clsx from 'clsx';

// ok = mint, bad = coral, warn = gold, v = violet, n = neutral
export type TagTone = 'ok' | 'bad' | 'warn' | 'v' | 'n';

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: TagTone;
}

export function Tag({ tone = 'n', className, ...rest }: TagProps) {
  return <span className={clsx('tag', tone, className)} {...rest} />;
}
