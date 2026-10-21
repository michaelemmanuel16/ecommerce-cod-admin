import clsx from 'clsx';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

/** A loading placeholder block. Decorative: put aria-busy on the region that is loading. */
export function Skeleton({ width = '100%', height = 14, className }: SkeletonProps) {
  return <div className={clsx('skel', className)} style={{ width, height }} aria-hidden="true" />;
}
