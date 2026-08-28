#!/usr/bin/env node
// CLI proof-of-work for the permission gate.
//
//   node finds/gate/cli.ts <url>            -- verdict for one URL
//   node finds/gate/cli.ts <url> --site     -- verdict + enumerated allowed pages for the whole site
//
// Runs directly under plain `node` (no build step, no ts-node/tsx) via
// Node's native TypeScript type-stripping -- see cache.ts's commit message
// for why that constrains which TS syntax this codebase can use.

import { checkPage, checkSite } from './gate.ts';

async function main(): Promise<void> {
  const [url, mode] = process.argv.slice(2);
  if (!url) {
    console.error('usage: node finds/gate/cli.ts <url> [--site]');
    process.exitCode = 1;
    return;
  }

  if (mode === '--site') {
    const result = await checkSite(url);
    console.log(JSON.stringify({ site: result.site }, null, 2));
    console.log(`\nallowed pages (${result.allowed.length}${result.truncated ? ', truncated' : ''}):`);
    for (const record of result.allowed) console.log(`  ALLOW    ${record.url}`);
    console.log(`\ndisallowed pages (${result.disallowed.length}):`);
    for (const record of result.disallowed) console.log(`  DISALLOW ${record.url}  -- ${record.verdict.reason}`);
    return;
  }

  const record = await checkPage(url);
  console.log(JSON.stringify(record, null, 2));
}

main().catch((err) => {
  console.error('gate error:', err);
  process.exitCode = 1;
});
