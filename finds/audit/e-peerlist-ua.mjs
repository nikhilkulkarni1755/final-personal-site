// The Peerlist ingest path (finds/sources/run-peerlist.ts:71 + peerlist.ts:26,141)
// launches Chromium with an explicit desktop-Chrome User-Agent, navigates to
// /robots.txt to clear the Cloudflare challenge, then issues its API calls as
// in-page fetch(). Reproduced here against a loopback stand-in for peerlist.io,
// using the lane's own exported constant and the same two-step pattern.
import { createServer } from 'node:http';
const seen = [];
const srv = createServer((rq, rs) => {
  seen.push({ url: rq.url, ua: rq.headers['user-agent'], cookie: rq.headers.cookie ?? null });
  if (rq.url === '/robots.txt') { rs.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'cf_clearance=CHALLENGE_TOKEN; Path=/' }); rs.end('User-agent: *\nAllow: /\n'); return; }
  rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{"data":{"spotlight":[]}}');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${srv.address().port}`;
const { PEERLIST_CHROME_UA } = await import('../sources/peerlist.ts');
const pw = await import('/opt/homebrew/lib/node_modules/playwright/index.js'); const chromium = (pw.default ?? pw).chromium;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: PEERLIST_CHROME_UA });   // run-peerlist.ts:71
const page = await context.newPage();
await page.goto(`${origin}/robots.txt`);                                        // peerlist.ts:26
await page.evaluate(async (u) => { const r = await fetch(u); await r.text(); },  // peerlist.ts:141
  `${origin}/api/v1/users/projects/spotlight?year=2026&week=35`);
await browser.close(); srv.close();
console.log('constant in finds/sources/peerlist.ts:17 ->', PEERLIST_CHROME_UA);
for (const s of seen) console.log(`\n${s.url}\n   ua     : ${s.ua}\n   cookie : ${s.cookie ?? 'none'}`);
console.log('\nbot.txt: "Never spoofs a browser User-Agent or claims to be anything else."');
console.log('bot.txt: "Never sends a cookie, an Authorization header, or an API key."');
