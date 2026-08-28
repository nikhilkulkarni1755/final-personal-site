// Persists the Telegram getUpdates offset across process restarts. Passing
// offset=N to getUpdates tells Telegram it may forget every update up to
// N-1; if we lose track of the last offset we either replay old updates
// (offset too low / absent) or drop ones we never fetched (offset guessed
// too high). File-backed for now -- see finds-coord/lanes/W8.md for the
// known gap this leaves on ephemeral GitHub Actions runners and the
// proposed durable-store follow-up.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface OffsetStore {
  /** The next update_id to request, or undefined if nothing was ever stored. */
  read(): Promise<number | undefined>;
  write(offset: number): Promise<void>;
}

export class FileOffsetStore implements OffsetStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<number | undefined> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as { offset?: number };
      return typeof parsed.offset === 'number' ? parsed.offset : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async write(offset: number): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Write-then-rename: a crash mid-write can never leave a truncated file
    // that would corrupt the offset and cause a replay or a permanent stall.
    const tmpPath = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmpPath, JSON.stringify({ offset }), 'utf8');
    await rename(tmpPath, this.path);
  }
}
