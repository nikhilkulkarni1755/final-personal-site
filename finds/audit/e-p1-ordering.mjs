// E2: does the gate emit a request to a private/loopback address BEFORE P1 denies it?
import { createServer } from 'node:http';
const hits = [];
const srv = createServer((req,res)=>{
  hits.push({t:Date.now(), url:req.url, method:req.method, ua:req.headers['user-agent'], cookie:req.headers.cookie??null});
  if (req.url === '/robots.txt') { res.writeHead(200,{'content-type':'text/plain'}); res.end('User-agent: *\nAllow: /\n'); return; }
  res.writeHead(200,{'content-type':'text/html'}); res.end('<html><body>secret internal service</body></html>');
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const port = srv.address().port;
const { checkPage } = await import('../gate/gate.ts');

for (const target of [`http://127.0.0.1:${port}/`, `http://169.254.169.254.nip.io/latest/meta-data/`]) {
  const before = hits.length;
  let v;
  try { v = await checkPage(target); } catch(e){ console.log(target, 'threw', e.message); continue; }
  console.log(`\nTARGET ${target}`);
  console.log(`  verdict: allowed=${v.allowed} reason=${v.reason_code} rule=${v.precedence_rule}`);
  console.log(`  detail:  ${v.reason_detail}`);
  console.log(`  REQUESTS THAT ACTUALLY LEFT THE PROCESS while deciding: ${hits.length - before}`);
  for (const h of hits.slice(before)) console.log(`     -> ${h.method} ${h.url}  ua=${h.ua}`);
  console.log(`  evidence[] claims: ${v.evidence.map(e=>`${e.url} status=${e.http_status}`).join(' | ')}`);
}
srv.close();
