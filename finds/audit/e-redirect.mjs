// Does the gate's single network choke point constrain where a redirect
// lands? Two independent loopback origins; A 302s to B. Real sockets.
import { createServer } from 'node:http';
const hits = { A: [], B: [] };
const mk = (name, handler) => new Promise((res) => { const s = createServer((rq, rs) => { hits[name].push(rq.url); handler(rq, rs); }); s.listen(0, '127.0.0.1', () => res(s)); });
const B = await mk('B', (rq, rs) => { rs.writeHead(200, { 'content-type': 'text/html' }); rs.end('<html>ORIGIN B PRIVATE CONTENT</html>'); });
const bPort = B.address().port;
const A = await mk('A', (rq, rs) => { rs.writeHead(302, { location: `http://127.0.0.1:${bPort}/internal` }); rs.end(); });
const aPort = A.address().port;

const { safeFetch } = await import('../gate/safeFetch.ts');
const res = await safeFetch(`http://127.0.0.1:${aPort}/start`);
console.log('safeFetch("http://A/start") ->');
console.log('  final response url :', res.url);
console.log('  body               :', (await res.text()).slice(0, 60));
console.log('  requests seen by A :', hits.A);
console.log('  requests seen by B :', hits.B, '   <-- B was never gated, never robots-checked, never scope-checked');
A.close(); B.close();
