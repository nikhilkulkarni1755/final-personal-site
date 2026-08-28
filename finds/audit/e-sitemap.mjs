// W1's checkSite() feeds robots.txt's Sitemap: directives straight into
// enumerateSitemaps(), which fetches each one with no P0/P1/robots check.
// The URL therefore comes from the *audited site*, not from us.
import { createServer } from 'node:http';
const hits = [];
const INTERNAL = createServer((rq, rs) => { hits.push(rq.url); rs.writeHead(200, { 'content-type': 'text/plain' }); rs.end('INTERNAL SERVICE RESPONSE'); });
await new Promise((r) => INTERNAL.listen(0, '127.0.0.1', r));
const p = INTERNAL.address().port;
const { enumerateSitemaps } = await import('../gate/sitemap.ts');
const out = await enumerateSitemaps([`http://127.0.0.1:${p}/admin/sitemap.xml`], 'https://example.com');
console.log('enumerateSitemaps() with a loopback Sitemap: directive');
console.log('  requests that reached the loopback service:', hits);
console.log('  sitemapsFetched:', out.sitemapsFetched);
console.log('  -> the URL came from the audited site\'s own robots.txt (gate.ts:355-358); nothing scope-checked it.');
INTERNAL.close();
