import { installRecorder, report } from './recorder.mjs';
const HOME = 'https://example.com/';
const routes = {
  'https://example.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' },
  'https://example.com/': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><head><title>Acme</title></head><body><h1>Acme does X</h1><p>Acme is the fastest way to do X. Free forever. Open source. We have an API and an MCP server.</p><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/about">About</a><a href="/faq">FAQ</a><a href="/features">Features</a><a href="/changelog">Changelog</a><a href="/blog">Blog</a><a href="/api">API</a></body></html>' },
  'https://example.com/llms.txt': { status: 404, headers: { 'content-type': 'text/plain' }, body: 'nope' },
  'https://example.com/sitemap.xml': { status: 200, headers: { 'content-type': 'application/xml' }, body: '<urlset>' + ['pricing','docs','about','faq','features','changelog','blog','api','security','careers','terms','privacy','status','integrations','mcp','cli','sdk','webhooks','support','press'].map(p=>`<url><loc>https://example.com/${p}</loc></url>`).join('') + '</urlset>' },
  '*': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><h1>A page</h1><p>Acme is the fastest way to do X. It is free forever and open source. Our API, CLI, SDK and MCP server are documented. No waitlist.</p></body></html>' },
};
const { wire } = installRecorder(routes);
const { crawlCandidate } = await import('../verify/crawl.ts');
const t0 = Date.now();
const res = await crawlCandidate({ candidateId: '00000000-0000-0000-0000-000000000001', productUrl: HOME });
for (const rec of res.records) console.log('  REC', rec.evidence.url, rec.evidence.http_status);
console.log('crawl elapsed_ms', Date.now() - t0, '| evidence records:', res.records.length);
const r = report(wire, 'W4 crawlCandidate over one site');
console.log('\nPROMISE CHECK (bot.txt): "at most 25 pages per site, at least 2 seconds apart"');
console.log('  requests actually issued to example.com :', wire.length);
console.log('  evidence rows W4 believes it produced    :', res.records.length);
console.log('  requests issued <2000ms after the last   :', r.gaps.filter(g=>g<2000).length);
