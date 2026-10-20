// Minimal typing for the single lodash helper we import (no @types/lodash installed).
declare module 'lodash/debounce' {
  interface DebouncedFunc<T extends (...args: never[]) => unknown> {
    (...args: Parameters<T>): ReturnType<T> | undefined;
    cancel(): void;
    flush(): ReturnType<T> | undefined;
  }
  export default function debounce<T extends (...args: never[]) => unknown>(
    func: T,
    wait?: number,
    options?: { leading?: boolean; maxWait?: number; trailing?: boolean }
  ): DebouncedFunc<T>;
}
