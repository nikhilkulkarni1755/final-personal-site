import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDigest } from './render.ts';
import type { DigestInput } from './types.ts';

// Dry-run CLI: renders a digest and writes it to a file for inspection.
// Never sends -- no credential is imported here, only the pure renderer.
//
// Per D6 this tool does not invent data. It takes a real DigestInput as a
// JSON file (W5's selection output, once that exists) and renders exactly
// that. There is no built-in sample digest to fall back to.
//
// Usage: node finds/email/dry-run.ts <digest-input.json> [out-dir]

const [, , inputPath, outDirArg] = process.argv;

if (!inputPath) {
  console.error(
    'Usage: node finds/email/dry-run.ts <digest-input.json> [out-dir]\n' +
      'Renders a DigestInput JSON file to HTML + text and writes both to disk.\n' +
      'This is a RENDER ONLY -- nothing is sent, no credential is read.',
  );
  process.exit(1);
}

const input = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as DigestInput;
const { subject, html, text } = renderDigest(input);

const outDir = resolve(outDirArg ?? 'finds/email/.dry-run');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'subject.txt'), subject);
writeFileSync(resolve(outDir, 'digest.html'), html);
writeFileSync(resolve(outDir, 'digest.txt'), text);

console.log(`[DRY RUN -- RENDER ONLY, NOT SENT]`);
console.log(`  subject: ${subject}`);
console.log(`  wrote:   ${outDir}/digest.html`);
console.log(`           ${outDir}/digest.txt`);
