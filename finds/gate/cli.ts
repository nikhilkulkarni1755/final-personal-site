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
      const page = v.page.kind === 'fetched' ? ` (page: ${v.page.http_status}, ${v.page.body.length}B${v.page.truncated ? ' truncated' : ''})` : v.page.kind === 'not_fetched' ? ' (page: not fetched)' : ` (page error: ${v.page.error})`;
      console.log(`  ALLOW    ${v.url}  (${v.reason_code})${use}${page}`);
    }
    console.log(`\ndisallowed pages (${result.disallowed.length}):`);
    for (const v of result.disallowed) console.log(`  DISALLOW ${v.url}  -- ${v.reason_code}: ${v.reason_detail}`);
    return;
  }

  const verdict = await checkPage(url);
  // D21: `page.body` can be the whole page; print it separately, truncated,
  // rather than burying it (and every other field) in one giant JSON blob.
  const { page, ...verdictWithoutBody } = verdict;
  console.log(JSON.stringify(verdictWithoutBody, null, 2));
  if (page.kind === 'fetched') {
    console.log(`\npage: ${page.http_status} ${page.content_type ?? '(no content-type)'} -- ${page.body.length} bytes${page.truncated ? ' (truncated)' : ''}, sha256 ${page.content_sha256}`);
    console.log(page.body.slice(0, 500) + (page.body.length > 500 ? '\n... (truncated for display)' : ''));
  } else if (page.kind === 'error') {
    console.log(`\npage fetch error: ${page.error}`);
  } else {
    console.log('\npage: not fetched (verdict was not allowed, or the run\'s page budget was already spent)');
  }
}

main().catch((err) => {
  console.error('gate error:', err);
  process.exitCode = 1;
});
