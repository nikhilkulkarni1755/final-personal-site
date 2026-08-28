// ACCEPTED_CONTENT_TYPES (finds/verify/config.ts:50) has no application/xml
// or text/xml, so gatedFetch discards the body of every sitemap served the
// standard way -- and the evidence row still records a plain 200.
import { installRecorder } from './recorder.mjs';
const sm = '<urlset>' + ['pricing','docs','about','faq','features'].map(p=>`<url><loc>https://example.com/${p}</loc></url>`).join('') + '</urlset>';
async function run(ctype) {
  const { wire } = installRecorder({
    'https://example.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n' },
    'https://example.com/': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><p>Acme is the fastest way to do X.</p></body></html>' },
    'https://example.com/sitemap.xml': { status: 200, headers: { 'content-type': ctype }, body: sm },
    '*': { status: 404, headers: { 'content-type': 'text/plain' }, body: 'x' },
  });
  const mod = await import(`../verify/crawl.ts?ct=${encodeURIComponent(ctype)}`);
  const res = await mod.crawlCandidate({ candidateId: '00000000-0000-0000-0000-00000000000' + (ctype === 'application/xml' ? '4' : '5'), productUrl: 'https://example.com/' });
  const smRow = res.records.find((r) => r.evidence.url.endsWith('sitemap.xml'));
  const discovered = res.records.filter((r) => !/\/(|robots\.txt|llms\.txt|sitemap\.xml)$/.test(new URL(r.evidence.url).pathname));
  console.log(`content-type ${ctype.padEnd(18)} -> sitemap row http_status=${smRow?.evidence.http_status}, pages discovered from it: ${discovered.length}`);
  console.log(`   evidence detail: "${smRow?.evidence.observations?.[0]?.detail}"`);
  return wire;
}
await run('application/xml');   // what every real sitemap is served as
await run('text/plain');        // control
