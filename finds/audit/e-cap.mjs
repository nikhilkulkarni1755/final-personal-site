// Does the crawl honour "at most 25 pages per site" as REQUESTS, or only as
// evidence rows? Homepage links to 40 sub-pages; nothing else discovered.
import { installRecorder, report } from './recorder.mjs';
const links = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join('');
const routes = {
  'https://example.com/robots.txt': { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
  'https://example.com/': { status: 200, headers: { 'content-type': 'text/html' }, body: `<html><body><h1>Acme</h1><p>Acme is the fastest way to do X, free forever, open source, with an API.</p>${links}</body></html>` },
  '*': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body><p>Acme is free forever and open source. API, CLI, SDK and MCP documented. No waitlist.</p></body></html>' },
};
const { wire } = installRecorder(routes);
const { crawlCandidate } = await import('../verify/crawl.ts');
const res = await crawlCandidate({ candidateId: '00000000-0000-0000-0000-000000000002', productUrl: 'https://example.com/' });
const gaps = wire.slice(1).map((w, i) => w.t - wire[i].t);
console.log('evidence rows (what W4 counts against the 25 cap):', res.records.length);
console.log('HTTP requests actually issued to example.com   :', wire.length);
console.log('requests issued less than 2000 ms after the last:', gaps.filter(g => g < 2000).length, 'of', gaps.length);
console.log('median gap ms:', gaps.sort((a,b)=>a-b)[Math.floor(gaps.length/2)]);
