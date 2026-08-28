// What does the Playwright render path put on the wire? R2 §5.3 caps and
// bot.txt's "25 pages per site, 2 seconds apart" are enforced in gate.ts /
// verify/gate.ts; renderPage() goes around both.
import { createServer } from 'node:http';
const hits = { SITE: [], THIRD: [] };
const mk = (name, handler) => new Promise((res) => { const s = createServer((rq, rs) => { hits[name].push({ url: rq.url, ua: rq.headers['user-agent'] }); handler(rq, rs); }); s.listen(0, '127.0.0.1', () => res(s)); });
const THIRD = await mk('THIRD', (rq, rs) => { rs.writeHead(200, { 'content-type': 'application/javascript' }); rs.end('window.__t=1;'); });
const tPort = THIRD.address().port;
const SITE = await mk('SITE', (rq, rs) => {
  if (rq.url === '/robots.txt') { rs.writeHead(200, { 'content-type': 'text/plain' }); rs.end('User-agent: *\nDisallow: /\n'); return; }
  rs.writeHead(200, { 'content-type': 'text/html' });
  rs.end(`<html><head><script src="http://127.0.0.1:${tPort}/analytics.js"></script></head><body><div id="root"></div>
  <script>fetch('http://127.0.0.1:${tPort}/api/track');for(let i=0;i<8;i++)fetch('/spa-xhr-'+i);</script></body></html>`);
});
const sPort = SITE.address().port;

process.env.FINDS_PLAYWRIGHT_MODULE = '/opt/homebrew/lib/node_modules/playwright/index.js';
const { renderPage } = await import('../verify/render.ts');
const t0 = Date.now();
const r = await renderPage(`http://127.0.0.1:${sPort}/`);
console.log('renderPage() returned in', Date.now() - t0, 'ms');
console.log('  contactedOrigins reported :', r.contactedOrigins);
console.log('  requests the SITE saw     :', hits.SITE.length, hits.SITE.map(h => h.url).join(' '));
console.log('  requests a THIRD PARTY saw:', hits.THIRD.length, hits.THIRD.map(h => h.url).join(' '));
console.log('  UA presented to third party:', hits.THIRD[0]?.ua);
console.log('  note: SITE /robots.txt says Disallow: / and renderPage never asked.');
SITE.close(); THIRD.close();
