// Tracks HITL questions that have been sent and are awaiting Nikhil's
// answer, so an incoming reply or button tap can be matched back to the
// question that asked it. File-backed for the same reason as
// offsetStore.ts (see finds-coord/lanes/W8.md).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PendingQuestion } from './types.ts';

export class PendingStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private async readAll(): Promise<PendingQuestion[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return JSON.parse(raw) as PendingQuestion[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async writeAll(entries: PendingQuestion[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmpPath = `${this.path}.tmp-${process.pid}`;
    await writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf8');
    await rename(tmpPath, this.path);
  }

  async add(entry: PendingQuestion): Promise<void> {
    const entries = await this.readAll();
    entries.push(entry);
    await this.writeAll(entries);
  }

  async findByQuestionId(questionId: string): Promise<PendingQuestion | undefined> {
    return (await this.readAll()).find((e) => e.questionId === questionId);
  }

  async findBySentMessageId(messageId: number): Promise<PendingQuestion | undefined> {
    return (await this.readAll()).find((e) => e.sentMessageId === messageId);
  }

  async remove(questionId: string): Promise<void> {
    const entries = await this.readAll();
    await this.writeAll(entries.filter((e) => e.questionId !== questionId));
  }

  /**
   * Records free text sent before any tap as a draft why_interesting on an
   * approval question (D32) -- the entry stays pending; this never writes
   * to finds_approvals. A no-op if `questionId` isn't an approval question
   * (or isn't pending at all), so a caller can't accidentally attach a note
   * to a plain askQuestion().
   */
  async setDraftNote(questionId: string, note: string): Promise<void> {
    const entries = await this.readAll();
    const idx = entries.findIndex((e) => e.questionId === questionId);
    if (idx === -1) return;
    const entry = entries[idx];
    if (!entry.approval) return;
    entries[idx] = { ...entry, approval: { ...entry.approval, draftNote: note } };
    await this.writeAll(entries);
  }
}
