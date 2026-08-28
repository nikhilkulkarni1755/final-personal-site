#!/usr/bin/env node
// Drift check for functions/_middleware.js's STATIC_ROUTES.
//
// STATIC_ROUTES is a hand-maintained mirror of the extensionless <Route
// path="..."> entries in src/App.tsx (the client-side router's own source of
// truth). A route added there and not here silently 404s at the edge for
// humans and agents alike — that already happened once (/interesting-finds).
// This can't be solved by importing App.tsx directly: it's a React tree,
// executing it here would run browser-only code outside a browser, and
// Cloudflare Pages Functions have no filesystem access at request time to
// re-check it live in production. So this is a text-based check instead,
// meant to be run by hand (or wired into CI) whenever a route is added:
//
//   node functions/_lib/check-routes.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appTsx = readFileSync(join(here, '../../src/App.tsx'), 'utf8');
const middleware = readFileSync(join(here, '../_middleware.js'), 'utf8');
const blogs = JSON.parse(readFileSync(join(here, '../../src/data/blogs.json'), 'utf8'));

// Every <Route path="..."> in App.tsx, minus dynamic :param ones (just
// /blog/:slug today — its concrete slugs come from src/data/blogs.json, and
// each of those also has its own literal <Route path="/blog/<slug>">, which
// is covered below the same way isKnownRoute() in _middleware.js covers it:
// via BLOG_SLUGS, not via STATIC_ROUTES.
const blogSlugRoutes = new Set(blogs.map((post) => `/blog/${post.slug}`));
const appRoutes = new Set(
  [...appTsx.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((path) => !path.includes(':') && !blogSlugRoutes.has(path)),
);

// The STATIC_ROUTES Map literal in _middleware.js, read the same way — as
// text, not executed — so this has no dependency on how that module loads.
const staticRoutesBlock = middleware.match(/const STATIC_ROUTES = new Map\(\[([\s\S]*?)\]\);/);
if (!staticRoutesBlock) {
  console.error('Could not find STATIC_ROUTES in functions/_middleware.js — check the regex above still matches.');
  process.exit(1);
}
const allowlist = new Set(
  [...staticRoutesBlock[1].matchAll(/\[\s*'([^']+)'/g)].map((m) => m[1]),
);

const missing = [...appRoutes].filter((p) => !allowlist.has(p));
const stale = [...allowlist].filter((p) => !appRoutes.has(p));

if (missing.length || stale.length) {
  if (missing.length) {
    console.error('Routes in src/App.tsx missing from STATIC_ROUTES (functions/_middleware.js):');
    for (const p of missing) console.error(`  ${p}`);
  }
  if (stale.length) {
    console.error('Entries in STATIC_ROUTES with no matching static <Route> in src/App.tsx:');
    for (const p of stale) console.error(`  ${p}`);
  }
  process.exit(1);
}

console.log(`OK — ${allowlist.size} static routes in functions/_middleware.js match src/App.tsx exactly.`);
