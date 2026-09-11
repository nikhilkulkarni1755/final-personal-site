/**
 * The tool guard, tested without a browser or a GPU.
 *
 *   node --test src/components/fireworks/tools.test.ts
 *
 * These are the structural rules a jailbroken model would have to get past:
 * unknown tools, paths outside the project, ambiguous replaces. Each must
 * come back as a refusal, never as an edit.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileTree, runTool, type ToolFile } from './tools.ts';

const CSS = ':root {\n  --bg: #F4F8FA;\n  --ink: #0E1417;\n}\nbody { background: var(--bg); }\n';
const FILES: ToolFile[] = [
  { path: 'frontend/style.css', text: CSS },
  { path: 'backend/app.py', text: 'def main():\n    return 1\n' },
];
const ALLOWED = new Set(FILES.map((file) => file.path));

test('ls lists every file with a line count, or one directory', () => {
  const out = runTool('ls', JSON.stringify({ path: '.' }), FILES, ALLOWED);
  assert.equal(out.refused, undefined);
  assert.match(out.content, /frontend\/style\.css \(6 lines\)/);
  assert.equal(fileTree(FILES), out.content);
  assert.equal(runTool('ls', JSON.stringify({ path: 'backend' }), FILES, ALLOWED).content, 'backend/app.py (3 lines)');
  assert.equal(runTool('ls', '{}', FILES, ALLOWED).summary, 'ls . → 2 files');
});

test('grep returns path:line: text and a count', () => {
  const out = runTool('grep', JSON.stringify({ pattern: '--bg' }), FILES, ALLOWED);
  assert.match(out.content, /^frontend\/style\.css:2: {3}--bg: #F4F8FA;$/m);
  assert.equal(out.summary, 'grep "--bg" → 2 matches in 1 file');
});

test('read returns numbered lines within a range', () => {
  const out = runTool('read', JSON.stringify({ path: 'frontend/style.css', start: 2, end: 3 }), FILES, ALLOWED);
  assert.equal(out.content, '2:   --bg: #F4F8FA;\n3:   --ink: #0E1417;\n(3 more lines; read with start=4)');
});

test('replace swaps exactly one match and returns the edit', () => {
  const out = runTool('replace', JSON.stringify({ path: 'frontend/style.css', old: '--bg: #F4F8FA;', new: '--bg: #F54927;' }), FILES, ALLOWED);
  assert.equal(out.refused, undefined);
  assert.ok(out.edit);
  assert.match(out.edit!.text, /--bg: #F54927;/);
  assert.doesNotMatch(out.edit!.text, /#F4F8FA/);
});

test('replace fails closed when old is missing', () => {
  const out = runTool('replace', JSON.stringify({ path: 'frontend/style.css', old: 'nope', new: 'x' }), FILES, ALLOWED);
  assert.equal(out.refused, true);
  assert.equal(out.edit, undefined);
});

test('replace fails closed when old is ambiguous', () => {
  const out = runTool('replace', JSON.stringify({ path: 'frontend/style.css', old: '--', new: 'x' }), FILES, ALLOWED);
  assert.equal(out.refused, true);
  assert.match(out.content, /more than once/);
});

test('a path outside the project is refused, however it is spelled', () => {
  for (const path of ['/etc/passwd', '../../secret', 'docscribe/frontend/nope.css', 'frontend/style.css/../x']) {
    const out = runTool('read', JSON.stringify({ path }), FILES, ALLOWED);
    assert.equal(out.refused, true, path);
  }
});

test('the project prefix the model was shown is tolerated', () => {
  const out = runTool('read', JSON.stringify({ path: 'docscribe/frontend/style.css' }), FILES, ALLOWED);
  assert.equal(out.refused, undefined);
});

test('an unknown tool is refused and named', () => {
  const out = runTool('shell', JSON.stringify({ cmd: 'rm -rf /' }), FILES, ALLOWED);
  assert.equal(out.refused, true);
  assert.match(out.content, /Unknown tool "shell"/);
});

test('malformed arguments are refused rather than thrown', () => {
  const out = runTool('grep', '{not json', FILES, ALLOWED);
  assert.equal(out.refused, true);
});

test('write refuses an empty file and append adds a trailing newline', () => {
  assert.equal(runTool('write', JSON.stringify({ path: 'backend/app.py', text: '  ' }), FILES, ALLOWED).refused, true);
  const out = runTool('append', JSON.stringify({ path: 'backend/app.py', text: 'x = 2' }), FILES, ALLOWED);
  assert.equal(out.edit!.text, 'def main():\n    return 1\nx = 2\n');
});
