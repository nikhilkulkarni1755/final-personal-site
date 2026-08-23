/**
 * Line-level diff, used to show what the model changed.
 *
 * Classic LCS over lines. The files here are a few hundred lines each, so the
 * O(n*m) table is a few tens of thousands of cells — cheap enough to recompute
 * on every token flush while a response streams in, which is exactly what the
 * streaming diff needs.
 */

export type DiffKind = 'context' | 'add' | 'delete';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the original file, when the line exists there. */
  oldLine: number | null;
  /** 1-based line number in the new file, when the line exists there. */
  newLine: number | null;
}

const lcsTable = (a: string[], b: string[]): Uint32Array => {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }
  return table;
};

/** Diff two texts by line. */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = before.split('\n');
  const b = after.split('\n');
  const width = b.length + 1;
  const table = lcsTable(a, b);

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      out.push({ kind: 'delete', text: a[i], oldLine: i + 1, newLine: null });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j], oldLine: null, newLine: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ kind: 'delete', text: a[i], oldLine: i + 1, newLine: null });
    i += 1;
  }
  while (j < b.length) {
    out.push({ kind: 'add', text: b[j], oldLine: null, newLine: j + 1 });
    j += 1;
  }
  return out;
};

export interface DiffStats {
  added: number;
  removed: number;
  changed: boolean;
}

export const diffStats = (lines: DiffLine[]): DiffStats => {
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'delete').length;
  return { added, removed, changed: added > 0 || removed > 0 };
};

/**
 * Collapse long runs of unchanged lines, keeping `padding` lines of context
 * either side of every change. Returns hunks rather than one flat list so the
 * viewer can render a "… N unchanged lines" separator between them.
 */
export interface DiffHunk {
  lines: DiffLine[];
  skippedBefore: number;
}

export const collapseContext = (lines: DiffLine[], padding = 3): DiffHunk[] => {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    for (let offset = -padding; offset <= padding; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < lines.length) keep[target] = true;
    }
  });

  if (!keep.some(Boolean)) return [{ lines, skippedBefore: 0 }];

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let skipped = 0;
  keep.forEach((isKept, index) => {
    if (isKept) {
      if (!current.length) hunks.push({ lines: current, skippedBefore: skipped });
      current.push(lines[index]);
      skipped = 0;
    } else if (current.length) {
      current = [];
      skipped = 1;
    } else {
      skipped += 1;
    }
  });
  return hunks.filter((hunk) => hunk.lines.length > 0);
};
