// Can a THIRD PARTY choose a URL the pipeline requests? crawl.ts:237 reads
// Sitemap: directives out of the audited site's robots.txt and puts each one
// through gatedFetch -> checkPage, which fetches THAT origin's robots.txt
// before P1 ever runs.
import { installRecorder } from './recorder.mjs';
const routes = {
  'https://example.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' },
    body: 'User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:9000/internal/sitemap.xml\nSitemap: http://169.254.169.254/latest/meta-data/sitemap.xml\n' },
  'https://example.com/': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><p>Acme is the fastest way to do X.</p></body></html>' },
  '*': { status: 404, headers: { 'content-type': 'text/plain' }, body: 'x' },
};
const { wire } = installRecorder(routes);
const { crawlCandidate } = await import('../verify/crawl.ts');
await crawlCandidate({ candidateId: '00000000-0000-0000-0000-000000000003', productUrl: 'https://example.com/' });
console.log('URLs the pipeline asked the network for:');
for (const w of wire) console.log('   ', w.method, w.url);
const offsite = wire.filter((w) => !w.url.startsWith('https://example.com'));
console.log('\nrequests to hosts the AUDITED SITE chose, not us:', offsite.length);
for (const w of offsite) console.log('   !!', w.url);
