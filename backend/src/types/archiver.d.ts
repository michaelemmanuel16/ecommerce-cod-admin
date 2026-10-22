// Minimal typing for the parts of archiver 5 that the data export uses (there is no @types/archiver in the tree).
declare module 'archiver' {
  import { Readable } from 'stream';

  interface ArchiverError extends Error {
    code?: string;
  }

  interface Archiver extends Readable {
    append(source: Readable | Buffer | string, data: { name: string }): this;
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    finalize(): Promise<void>;
    abort(): this;
    on(event: 'error' | 'warning', listener: (err: ArchiverError) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  function archiver(format: 'zip', options?: { zlib?: { level?: number } }): Archiver;
  export = archiver;
}
