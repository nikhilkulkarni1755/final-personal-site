/**
 * The agent's tools, run in the browser against the visitor's working copy.
 *
 * There is no filesystem. The project is `{path -> text}` in React state, so
 * every tool is a pure function over strings: `ls` maps, `grep` searches,
 * `read` slices, `replace` swaps one exact span. Nothing here touches a
 * network or a process, and the tab is already the isolation boundary, so
 * this adds no sandbox layer and no latency. The whole cost of a run is the
 * model's turns.
 *
 * Two rules carry the safety, and both live here rather than in the prompt:
 * only these six tools exist (anything else is a refusal the model is told
 * about), and `replace` fails closed unless `old` matches exactly once. A
 * jailbroken model still cannot put arbitrary content anywhere but inside an
 * allowed file's text, which is rendered as text.
 */

export interface ToolFile {
  path: string;
  text: string;
}

/** The model's one-word refusal, verbatim from the contract. */
export const OUT_OF_SCOPE = 'OUT_OF_SCOPE';

/** What the harness emits as prompt_contract.json; the source of truth is capture/prompt_contract.py. */
export interface PromptContract {
  /** The agent loop's prompt: tree first, tools for everything else. */
  agent_system_prompt: string;
  out_of_scope_token: string;
  allowed_paths: string[];
}

export type ToolName = 'ls' | 'grep' | 'read' | 'replace' | 'append' | 'write';

const NAMES: readonly ToolName[] = ['ls', 'grep', 'read', 'replace', 'append', 'write'];

/** OpenAI-format declarations, sent in the request's `tools` field every turn. */
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'ls',
      // A parameter is required on purpose: the engine's parser for this
      // model's call format drops a call that carries no parameters at all
      // (seen 2026-09-11: `<function=ls></function>` arrived as plain text).
      description: 'List files with their line counts. `path` is a directory prefix such as "frontend" or "backend"; use "." for the whole project.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory prefix, or "." for everything.' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search all files (or one) for a regular expression. Returns path:line: text, at most 50 matches.',
      parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string', description: 'Optional: restrict to one file.' } }, required: ['pattern'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a file, or a 1-based inclusive line range of it. Returns numbered lines, at most 200.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' } }, required: ['path'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace',
      description: 'Replace one exact span of text in a file. `old` must occur exactly once; copy it verbatim from what you read.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'append',
      description: 'Append text to the end of a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write',
      description: 'Replace the entire contents of a file. Only for changes that touch most of it.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] },
    },
  },
] as const;

export interface ToolOutcome {
  /** What goes back to the model as the tool message. */
  content: string;
  /** One line for the trace: "grep '--bg' → 3 matches in 1 file". */
  summary: string;
  /** Set when the tool changed a file; the caller writes it to the working copy. */
  edit?: { path: string; text: string };
  /** True when the call was refused or failed; the model is told why in `content`. */
  refused?: boolean;
}

const MAX_MATCHES = 50;
const MAX_LINES = 200;

const normalise = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^docscribe\//, '');

const refuse = (summary: string, content = summary): ToolOutcome => ({ content, summary, refused: true });

/**
 * Run one tool call. Never throws: a bad tool name, a path outside the
 * project, malformed arguments or an ambiguous replace all come back as a
 * refusal the model can read and correct.
 */
export function runTool(name: string, rawArgs: string, files: ToolFile[], allowed: Set<string>): ToolOutcome {
  if (!(NAMES as readonly string[]).includes(name)) return refuse(`${name}: not a tool`, `Unknown tool "${name}". The tools are ${NAMES.join(', ')}.`);

  let args: Record<string, unknown>;
  try {
    args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    return refuse(`${name}: malformed arguments`, 'Arguments were not valid JSON.');
  }

  const byPath = new Map(files.map((file) => [file.path, file]));
  const requirePath = (): { file: ToolFile } | { refusal: ToolOutcome } => {
    const path = normalise(args.path);
    if (!allowed.has(path)) return { refusal: refuse(`${name} ${path || '(no path)'}: not in the project`, `"${path}" is not a file in this project. Use ls.`) };
    const file = byPath.get(path);
    return file ? { file } : { refusal: refuse(`${name} ${path}: missing`, `"${path}" has no contents.`) };
  };

  switch (name as ToolName) {
    case 'ls': {
      const prefix = normalise(args.path).replace(/^\.$/, '').replace(/\/$/, '');
      const listed = files.filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`));
      return {
        content: listed.length ? fileTree(listed) : `nothing under "${prefix}"`,
        summary: `ls ${prefix || '.'} → ${listed.length} file${listed.length === 1 ? '' : 's'}`,
      };
    }

    case 'grep': {
      const pattern = String(args.pattern ?? '');
      if (!pattern) return refuse('grep: no pattern', 'grep needs a pattern.');
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return refuse(`grep ${JSON.stringify(pattern)}: bad pattern`, `"${pattern}" is not a valid regular expression.`);
      }
      let scope = files;
      if (args.path) {
        const target = requirePath();
        if ('refusal' in target) return target.refusal;
        scope = [target.file];
      }
      const matches: string[] = [];
      const touched = new Set<string>();
      for (const file of scope) {
        file.text.split('\n').forEach((line, index) => {
          if (matches.length < MAX_MATCHES && regex.test(line)) {
            matches.push(`${file.path}:${index + 1}: ${line}`);
            touched.add(file.path);
          }
        });
      }
      const more = matches.length === MAX_MATCHES ? `\n(stopped at ${MAX_MATCHES} matches)` : '';
      return {
        content: matches.length ? matches.join('\n') + more : 'no matches',
        summary: `grep ${JSON.stringify(pattern)} → ${matches.length} match${matches.length === 1 ? '' : 'es'} in ${touched.size} file${touched.size === 1 ? '' : 's'}`,
      };
    }

    case 'read': {
      const target = requirePath();
      if ('refusal' in target) return target.refusal;
      const { file } = target;
      const lines = file.text.split('\n');
      const start = Math.max(1, Math.floor(Number(args.start) || 1));
      const end = Math.min(lines.length, Math.floor(Number(args.end) || lines.length), start + MAX_LINES - 1);
      const body = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n');
      const more = end < lines.length ? `\n(${lines.length - end} more lines; read with start=${end + 1})` : '';
      return { content: body + more, summary: `read ${file.path}${args.start || args.end ? ` ${start}-${end}` : ''}` };
    }

    case 'replace': {
      const target = requirePath();
      if ('refusal' in target) return target.refusal;
      const { file } = target;
      const oldText = String(args.old ?? '');
      const newText = String(args.new ?? '');
      if (!oldText) return refuse(`replace ${file.path}: empty old`, '`old` must not be empty.');
      const first = file.text.indexOf(oldText);
      if (first < 0) return refuse(`replace ${file.path}: old text not found`, '`old` was not found in the file. Read the file and copy the text exactly.');
      if (file.text.indexOf(oldText, first + 1) >= 0) return refuse(`replace ${file.path}: old text is not unique`, '`old` occurs more than once. Include more surrounding lines so it matches exactly once.');
      const text = file.text.slice(0, first) + newText + file.text.slice(first + oldText.length);
      const delta = newText.split('\n').length - oldText.split('\n').length;
      return { content: `replaced in ${file.path}`, summary: `replace ${file.path} (${delta >= 0 ? '+' : ''}${delta} lines)`, edit: { path: file.path, text } };
    }

    case 'append': {
      const target = requirePath();
      if ('refusal' in target) return target.refusal;
      const { file } = target;
      const extra = String(args.text ?? '');
      if (!extra) return refuse(`append ${file.path}: empty`, '`text` must not be empty.');
      const text = file.text.replace(/\n?$/, '\n') + extra.replace(/\n?$/, '\n');
      return { content: `appended to ${file.path}`, summary: `append ${file.path} (+${extra.split('\n').length} lines)`, edit: { path: file.path, text } };
    }

    case 'write': {
      const target = requirePath();
      if ('refusal' in target) return target.refusal;
      const { file } = target;
      const text = String(args.text ?? '');
      if (!text.trim()) return refuse(`write ${file.path}: empty`, 'Refusing to write an empty file.');
      return { content: `wrote ${file.path}`, summary: `write ${file.path} (${text.split('\n').length} lines)`, edit: { path: file.path, text } };
    }
  }
}

/** The project as the model first sees it: paths and sizes, nothing else. */
export const fileTree = (files: ToolFile[]): string =>
  files.map((file) => `${file.path} (${file.text.split('\n').length} lines)`).join('\n');
