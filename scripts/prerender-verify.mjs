/**
 * Asserts the invariants of the prerender output. Three defects reached review
 * because "the route renders real content" was the only thing being checked:
 * every page declared the homepage as its canonical, non-home pages inherited the
 * homepage's JSON-LD, and the blocks accumulated on every rebuild. Each of those
 * is a one-line assertion here.
 *
 * Run after `npm run prerender`. Exits non-zero on the first route that fails.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROUTES, UNRENDERED, assertNodeSupportsTypeScript } from './prerender.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Optional, exactly as in prerender.mjs: W3 owns this file. Without it the
// structural invariants (one canonical, one JSON-LD block, real content) are
// still checked — only the comparisons against expected values are skipped.
const META_PATH = join(ROOT, 'src/data/routeMeta.ts');
if (existsSync(META_PATH)) assertNodeSupportsTypeScript();
const routeMeta = existsSync(META_PATH)
  ? (await import(pathToFileURL(META_PATH).href)).routeMeta
  : null;
if (!routeMeta) console.log('src/data/routeMeta.ts not present — checking structure only\n');

const all = (html, re) => [...html.matchAll(re)];
const failures = [];

for (const { path } of ROUTES) {
  const file = join(DIST, path === '/' ? 'index.html' : `${path}.html`);
  const html = await readFile(file, 'utf8');
  const meta = routeMeta?.[path];
  const bad = (msg) => failures.push(`${path}: ${msg}`);

  if (html.includes('<div id="root"></div>')) bad('empty #root — no prerendered content');

  // Duplicates are the failure mode that shipped, so they are checked either way.
  // Requiring exactly one only makes sense once routeMeta supplies the values.
  const canonicals = all(html, /<link rel="canonical" href="([^"]*)">/g);
  // Matches a block with attributes too (the finds page tags its own with an id),
  // so a runtime-injected script that survived into the file is actually counted.
  const blocks = all(html, /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
  const alternates = all(html, ALTERNATE);
  if (canonicals.length > 1) bad(`${canonicals.length} canonical tags, expected at most 1`);
  if (blocks.length > 1) bad(`${blocks.length} JSON-LD blocks, expected at most 1`);
  if (alternates.length > 1) bad(`${alternates.length} markdown alternates, expected at most 1`);

  // The markdown twin, checked against the file on disk rather than against
  // routeMeta alone: R1 found an advertised twin that does not resolve is worse
  // than none. Anchored on W2's path contract, so it also catches the case where
  // W3's field is named something injectMeta does not read — the tag would simply
  // never appear, which is exactly the kind of silence this is here to break.
  const twin = twinFor(path);
  if (alternates.length === 1) {
    const href = new URL(alternates[0][1], 'https://nikhilkulkarni1755.com').pathname;
    if (href !== twin) bad(`markdown alternate points at ${href}, expected ${twin}`);
    else if (!existsSync(join(DIST, href))) bad(`markdown alternate ${href} does not resolve — no such file in dist/`);
  } else if (meta) {
    const stray = Object.entries(meta).find(([, v]) => typeof v === 'string' && v.endsWith('.md'));
    if (stray) bad(`routeMeta has "${stray[0]}" = ${stray[1]}, which injectMeta does not read — agree the field name with W1`);
    else if (existsSync(join(DIST, twin))) pendingAlternate.push(path);
  }

  if (!meta) {
    console.log(`${path.padEnd(34)} canonical-tags=${canonicals.length} jsonld-blocks=${blocks.length} content=ok`);
    continue;
  }

  if (canonicals.length !== 1) bad(`${canonicals.length} canonical tags, expected 1`);
  else if (canonicals[0][1] !== meta.canonical)
    bad(`canonical is ${canonicals[0][1]}, expected ${meta.canonical}`);
  if (blocks.length !== 1) bad(`${blocks.length} JSON-LD blocks, expected 1`);
  else if (JSON.stringify(JSON.parse(blocks[0][1])) !== JSON.stringify(meta.jsonLd))
    bad('JSON-LD does not match this route — contaminated from another page');

  for (const [key, want] of Object.entries(meta.og)) {
    const tags = all(html, new RegExp(`<meta property="og:${key}" content="([^"]*)">`, 'g'));
    if (tags.length !== 1) bad(`${tags.length} og:${key} tags, expected 1`);
    else if (tags[0][1] !== want) bad(`og:${key} is "${tags[0][1]}", expected "${want}"`);
  }
  for (const [key, want] of Object.entries(meta.twitter)) {
    const tags = all(html, new RegExp(`<meta name="twitter:${key}" content="([^"]*)">`, 'g'));
    if (tags.length !== 1) bad(`${tags.length} twitter:${key} tags, expected 1`);
    else if (tags[0][1] !== want) bad(`twitter:${key} is "${tags[0][1]}", expected "${want}"`);
  }

  const titles = all(html, /<title>([\s\S]*?)<\/title>/g);
  if (titles.length !== 1 || titles[0][1] !== meta.title) bad(`title is ${JSON.stringify(titles.map((t) => t[1]))}`);

  console.log(
    `${path.padEnd(34)} canonical=${meta.canonical.replace('https://nikhilkulkarni1755.com', '')} ` +
      `og:type=${meta.og.type} jsonld-nodes=${blocks.length === 1 ? JSON.parse(blocks[0][1])['@graph'].length : '?'} ` +
      `md=${alternates.length === 1 ? twin : 'none'}`
  );
}

// Routes we deliberately do not snapshot must still have their own file. Without
// one they fall through _redirects to the rendered homepage and impersonate it.
const home = await readFile(join(DIST, 'index.html'), 'utf8');
for (const path of UNRENDERED) {
  const html = await readFile(join(DIST, `${path}.html`), 'utf8');
  if (html === home) failures.push(`${path}: byte-identical to the homepage`);
  if (/<link rel="canonical"/.test(html)) failures.push(`${path}: claims a canonical it has no metadata for`);
  if (/ld\+json/.test(html)) failures.push(`${path}: carries JSON-LD from another page`);
  // D4 leaves this route without a markdown twin, so it must advertise none.
  if (all(html, ALTERNATE).length) failures.push(`${path}: advertises a markdown twin it does not have`);
  console.log(`${path.padEnd(34)} neutral shell, ${html.length} bytes, no canonical, no JSON-LD, no md alternate`);
}

if (pendingAlternate.length) {
  console.log(
    `\nNOT YET: ${pendingAlternate.length} route(s) have a markdown twin on disk but no ` +
      `alternate tag. Waiting on W3 to add \`markdownAlternate\` to routeMeta; injectMeta ` +
      `and these assertions are already in place for it.`
  );
}

if (failures.length) {
  console.error(`\n${failures.length} assertion(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(
  routeMeta
    ? `\nall ${ROUTES.length} routes: one correct canonical, one matching JSON-LD block, per-route OG/Twitter`
    : `\nall ${ROUTES.length} routes: real content, at most one canonical and one JSON-LD block each`
);
