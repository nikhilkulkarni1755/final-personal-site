// E1: adversarial test of finds/gate/safeFetch.ts
import { createServer } from 'node:http';
const seen = [];
const srv = createServer((req,res)=>{ seen.push({url:req.url, method:req.method, headers:req.headers}); res.writeHead(200,{'content-type':'text/plain'}); res.end('ok'); });
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const port = srv.address().port;
const base = `http://127.0.0.1:${port}`;
const { safeFetch } = await import('../gate/safeFetch.ts');

const attempts = [
  ['plain object cookie',        { headers: { Cookie: 'token=SECRET' } }],
  ['lowercase cookie',           { headers: { cookie: 'token=SECRET' } }],
  ['authorization',              { headers: { Authorization: 'Bearer SECRET' } }],
  ['Headers instance cookie',    { headers: new Headers({ Cookie: 'token=SECRET' }) }],
  ['array cookie',               { headers: [['Cookie','token=SECRET']] }],
  ['prototype cookie',           { headers: Object.create({ Cookie: 'token=SECRET' }) }],
  ['spoofed UA',                 { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/141' } }],
  ['POST',                       { method: 'POST' }],
  ['method lowercase post',      { method: 'post' }],
];
for (const [name, init] of attempts) {
  const before = seen.length;
  try { await safeFetch(base + '/e1', init); console.log(`  ${String(name).padEnd(28)} REQUEST SENT  (headers seen: ${JSON.stringify(pick(seen.at(-1)))})`); }
  catch (e) { console.log(`  ${String(name).padEnd(28)} refused: ${e.message.slice(0,70)}${seen.length>before?'  !!! BUT A REQUEST WENT OUT':''}`); }
}
function pick(r){ if(!r) return null; const h=r.headers; return {method:r.method, ua:h['user-agent'], cookie:h.cookie??null, authorization:h.authorization??null}; }
console.log('\n-- total requests reaching the server:', seen.length);
for (const r of seen) console.log('   ', r.method, r.url, '| ua=', r.headers['user-agent'], '| cookie=', r.headers.cookie ?? 'none', '| auth=', r.headers.authorization ?? 'none');
srv.close();
