/**
 * A very small syntax highlighter.
 *
 * This exists instead of CodeMirror or Shiki because the code pane on this page
 * is read-only — visitors type prompts, the model does the editing — so a full
 * editor would add a pile of dependencies to the portfolio for no behaviour.
 * The goal here is legibility, not grammar-accurate parsing.
 *
 * Everything is line-oriented, which is what the diff renderer needs anyway.
 * Multi-line constructs (block comments, triple-quoted strings) are tracked with
 * a tiny carry-over state between lines.
 */

export type TokenType = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'entity' | 'punct';

export interface Token {
  type: TokenType;
  text: string;
}

const KEYWORDS: Record<string, string[]> = {
  python: `False None True and as assert async await break class continue def del elif else except
    finally for from global if import in is lambda nonlocal not or pass raise return try while with yield
    self cls`.split(/\s+/),
  javascript: `await async break case catch class const continue debugger default delete do else export
    extends finally for from function if import in instanceof let new of return static super switch this
    throw try typeof var void while with yield true false null undefined`.split(/\s+/),
  css: [],
  html: [],
  markdown: [],
};

const KEYWORD_SETS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(KEYWORDS).map(([language, words]) => [language, new Set(words.filter(Boolean))]),
);

/** State carried from one line to the next (inside a block comment or string). */
export interface CarryState {
  block: null | { kind: 'comment' | 'string'; closer: string };
}

export const initialCarry = (): CarryState => ({ block: null });

const LINE_COMMENT: Record<string, string | null> = {
  python: '#',
  javascript: '//',
  css: null,
  html: null,
  markdown: null,
};

const isIdentStart = (char: string) => /[A-Za-z_$]/.test(char);
const isIdent = (char: string) => /[A-Za-z0-9_$]/.test(char);
const isDigit = (char: string) => /[0-9]/.test(char);

/**
 * Tokenize one line. `carry` is read and mutated so callers can walk a file
 * top-to-bottom and keep block constructs correct.
 */
export const tokenizeLine = (line: string, language: string, carry: CarryState): Token[] => {
  const tokens: Token[] = [];
  const keywords = KEYWORD_SETS[language] ?? new Set<string>();
  const lineComment = LINE_COMMENT[language] ?? null;
  let index = 0;

  const push = (type: TokenType, text: string) => {
    if (!text) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous.type === type) previous.text += text;
    else tokens.push({ type, text });
  };

  // Continue an unterminated block from the previous line.
  if (carry.block) {
    const closeAt = line.indexOf(carry.block.closer);
    if (closeAt === -1) {
      push(carry.block.kind, line);
      return tokens;
    }
    const end = closeAt + carry.block.closer.length;
    push(carry.block.kind, line.slice(0, end));
    index = end;
    carry.block = null;
  }

  // Markdown gets structural treatment rather than lexical.
  if (language === 'markdown') {
    if (/^\s*#{1,6}\s/.test(line)) return [{ type: 'keyword', text: line }];
    if (/^\s*(```|~~~)/.test(line)) return [{ type: 'entity', text: line }];
    if (/^\s*([-*+]|\d+[.)])\s/.test(line)) {
      const match = line.match(/^\s*([-*+]|\d+[.)])\s/)!;
      return [{ type: 'punct', text: match[0] }, { type: 'plain', text: line.slice(match[0].length) }];
    }
    return [{ type: 'plain', text: line }];
  }

  while (index < line.length) {
    const rest = line.slice(index);
    const char = line[index];

    // Line comment
    if (lineComment && rest.startsWith(lineComment)) {
      push('comment', rest);
      break;
    }

    // Block comment: /* ... */ for js/css, <!-- --> for html
    if ((language === 'javascript' || language === 'css') && rest.startsWith('/*')) {
      const close = rest.indexOf('*/', 2);
      if (close === -1) {
        push('comment', rest);
        carry.block = { kind: 'comment', closer: '*/' };
        break;
      }
      push('comment', rest.slice(0, close + 2));
      index += close + 2;
      continue;
    }
    if (language === 'html' && rest.startsWith('<!--')) {
      const close = rest.indexOf('-->', 4);
      if (close === -1) {
        push('comment', rest);
        carry.block = { kind: 'comment', closer: '-->' };
        break;
      }
      push('comment', rest.slice(0, close + 3));
      index += close + 3;
      continue;
    }

    // Python triple-quoted strings
    if (language === 'python' && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const quote = rest.slice(0, 3);
      const close = rest.indexOf(quote, 3);
      if (close === -1) {
        push('string', rest);
        carry.block = { kind: 'string', closer: quote };
        break;
      }
      push('string', rest.slice(0, close + 3));
      index += close + 3;
      continue;
    }

    // Single-line strings, including JS template literals.
    if (char === '"' || char === "'" || char === '`') {
      let cursor = index + 1;
      while (cursor < line.length) {
        if (line[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (line[cursor] === char) break;
        cursor += 1;
      }
      if (cursor >= line.length && char === '`') {
        push('string', line.slice(index));
        carry.block = { kind: 'string', closer: '`' };
        break;
      }
      push('string', line.slice(index, Math.min(cursor + 1, line.length)));
      index = cursor + 1;
      continue;
    }

    // Numbers, including hex colours in CSS.
    if (isDigit(char) || (char === '#' && language === 'css')) {
      const match = rest.match(/^#[0-9a-fA-F]{3,8}\b|^\d[\d_.]*(e[+-]?\d+)?[a-z%]*/i);
      if (match) {
        push('number', match[0]);
        index += match[0].length;
        continue;
      }
    }

    // Identifiers, keywords, and call sites.
    if (isIdentStart(char) || (language === 'css' && char === '-')) {
      let cursor = index;
      while (cursor < line.length && (isIdent(line[cursor]) || (language === 'css' && line[cursor] === '-'))) {
        cursor += 1;
      }
      const word = line.slice(index, cursor);
      if (keywords.has(word)) push('keyword', word);
      else if (language === 'css' && word.startsWith('--')) push('entity', word);
      else if (line[cursor] === '(') push('entity', word);
      else push('plain', word);
      index = cursor;
      continue;
    }

    // HTML tag names read as entities.
    if (language === 'html' && char === '<') {
      const match = rest.match(/^<\/?[A-Za-z][\w-]*/);
      if (match) {
        push('entity', match[0]);
        index += match[0].length;
        continue;
      }
    }

    if (/[{}()[\];:,.<>=+\-*/%!&|?@]/.test(char)) {
      push('punct', char);
      index += 1;
      continue;
    }

    push('plain', char);
    index += 1;
  }

  return tokens;
};

/** Tokenize a whole file, keeping block state correct across lines. */
export const tokenizeFile = (text: string, language: string): Token[][] => {
  const carry = initialCarry();
  return text.split('\n').map((line) => tokenizeLine(line, language, carry));
};

/** Tailwind classes per token type, tuned for the site's navy/white palette. */
export const TOKEN_CLASS: Record<TokenType, string> = {
  plain: 'text-[#001F3F]/85 dark:text-white/85',
  keyword: 'text-[#0B6FA4] dark:text-[#7EC8E3] font-medium',
  string: 'text-[#0F7B5A] dark:text-[#7FD8AE]',
  comment: 'text-[#001F3F]/40 dark:text-white/35 italic',
  number: 'text-[#A24B00] dark:text-[#F4A340]',
  entity: 'text-[#6B3FA0] dark:text-[#C4A6F0]',
  punct: 'text-[#001F3F]/55 dark:text-white/50',
};
