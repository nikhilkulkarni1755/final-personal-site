/**
 * Streaming parser for the model's edit contract.
 *
 * Mirrors capture/prompt_contract.py, which is the source of truth for the
 * system prompt and the allowed paths (both shipped in prompt_contract.json).
 * Two implementations exist because one runs where the tokens arrive and the
 * other where the captures are made; they must agree on what counts as valid.
 *
 * The important property: **nothing that fails to parse is ever rendered.** A
 * free-text box on a public page is untrusted input aimed at a model whose
 * output lands on screen, so the guard cannot be a well-worded instruction —
 * someone will try "ignore previous instructions" within a minute. Output that
 * does not fit the contract is discarded instead, which rejects attacks nobody
 * anticipated for the same reason as the ones that were.
 *
 * Bodies are file contents and are only ever rendered into a <textarea> or the
 * tokenizer — never with innerHTML — so a <script> tag inside one is inert text.
 */

export const OUT_OF_SCOPE = 'OUT_OF_SCOPE';

export interface StreamedEdit {
  path: string;
  /** Body so far. Grows while streaming; final once `closed` is true. */
  text: string;
  closed: boolean;
}

export interface StreamState {
  /** Edits seen so far, in order. The last may still be growing. */
  edits: StreamedEdit[];
  /** True once the response cannot be a valid set of edits. */
  outOfScope: boolean;
  reason: string;
  /** Path currently being written, for following along in the editor. */
  activePath: string | null;
}

const OPEN = /<edit\s+path\s*=\s*["']([^"']+)["']\s*>/i;
const CLOSE = /<\/edit>/i;

/**
 * Tags from the context wrapper we supply ourselves.
 *
 * Found by asking the real 30B: after two otherwise perfect edits it echoed
 * `</project_context>`, copied from the framing it was shown. Refusing valid
 * work over that would be this parser's fault rather than the model's, so these
 * are stripped before the prose check. Anything else still fails.
 */
const CONTEXT_TAG = /<\/?(project_context|file_tree|file)\b[^>]*>/gi;

const normalise = (raw: string): string =>
  raw.trim().replace(/^\/+/, '').replace(/^docscribe\//, '');

/**
 * Incremental parser. Feed it the accumulated response so far, repeatedly.
 *
 * Deliberately re-parses from the start each call rather than keeping a cursor:
 * responses here are a few KB, re-parsing is microseconds, and a stateful cursor
 * is where streaming parsers grow their bugs.
 */
export const parseStream = (accumulated: string, allowedPaths: Set<string>): StreamState => {
  const edits: StreamedEdit[] = [];
  let rest = accumulated;
  let consumed = '';

  for (;;) {
    const open = OPEN.exec(rest);
    if (!open) break;

    // Anything before an opening tag that is not whitespace means the model is
    // editorialising. A response that is partly an edit is not partly trusted.
    const before = rest.slice(0, open.index).replace(CONTEXT_TAG, '');
    if (before.trim()) {
      return { edits: [], outOfScope: true, reason: 'prose before an edit block', activePath: null };
    }

    const path = normalise(open[1]);
    if (!allowedPaths.has(path)) {
      return { edits: [], outOfScope: true, reason: `path not in the project: ${open[1]}`, activePath: null };
    }

    const afterOpen = rest.slice(open.index + open[0].length);
    const close = CLOSE.exec(afterOpen);

    if (!close) {
      // Still streaming this body.
      edits.push({ path, text: afterOpen.replace(/^\r?\n/, ''), closed: false });
      return { edits, outOfScope: false, reason: '', activePath: path };
    }

    edits.push({
      path,
      text: afterOpen.slice(0, close.index).replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
      closed: true,
    });
    consumed += rest.slice(0, open.index + open[0].length + close.index + close[0].length);
    rest = afterOpen.slice(close.index + close[0].length);
  }

  const trimmed = accumulated.trim();

  if (!edits.length) {
    if (!trimmed) return { edits: [], outOfScope: false, reason: '', activePath: null };
    // A partial opening tag is not yet a failure — wait for more tokens.
    if (/<e(d(i(t)?)?)?$/i.test(trimmed) || /<edit[^>]*$/i.test(trimmed)) {
      return { edits: [], outOfScope: false, reason: '', activePath: null };
    }
    return {
      edits: [],
      outOfScope: true,
      reason: trimmed.toUpperCase() === OUT_OF_SCOPE ? 'out of scope' : 'no edit block',
      activePath: null,
    };
  }

  // Trailing prose after the final block breaks the contract too.
  if (rest.replace(CONTEXT_TAG, '').trim()) {
    return { edits: [], outOfScope: true, reason: 'prose after the edit blocks', activePath: null };
  }

  return { edits, outOfScope: false, reason: '', activePath: null };
};

/** Whether a finished response may be applied to the project. */
export const isAcceptable = (state: StreamState): boolean =>
  !state.outOfScope && state.edits.length > 0 && state.edits.every((edit) => edit.closed && edit.text.trim());

export interface PromptContract {
  system_prompt: string;
  out_of_scope_token: string;
  allowed_paths: string[];
}
