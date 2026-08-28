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
    console.log(`origin: ${result.origin}`);
    console.log(`\nallowed pages (${result.allowed.length}${result.truncated ? ', truncated' : ''}):`);
    for (const v of result.allowed) {
      const use = v.use_rights ? ` [llm_ingest=${v.use_rights.llm_ingest} publish_excerpt=${v.use_rights.publish_excerpt} publish_link=${v.use_rights.publish_link}]` : '';
      console.log(`  ALLOW    ${v.url}  (${v.reason_code})${use}`);
    }
    console.log(`\ndisallowed pages (${result.disallowed.length}):`);
    for (const v of result.disallowed) console.log(`  DISALLOW ${v.url}  -- ${v.reason_code}: ${v.reason_detail}`);
    return;
  }

  const verdict = await checkPage(url);
  console.log(JSON.stringify(verdict, null, 2));
}

main().catch((err) => {
  console.error('gate error:', err);
  process.exitCode = 1;
});
