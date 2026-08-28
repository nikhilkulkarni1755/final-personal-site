// Audit harness (lane V2). Replaces the global fetch with a recorder that
// answers from a route table and sends nothing to the network, so every
// request the pipeline WOULD put on the wire -- URL, method, and the exact
// header bag -- is captured verbatim. Nothing in finds/** is modified or
// stubbed: safeFetch, gate.ts and crawl.ts all run as merged.
export function installRecorder(routes) {
  const wire = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = {};
    const h = init.headers;
    if (h) for (const [k, v] of (h instanceof Headers ? h.entries() : Array.isArray(h) ? h : Object.entries(h))) headers[String(k).toLowerCase()] = v;
    wire.push({ t: Date.now(), url, method: init.method ?? 'GET', headers, redirect: init.redirect ?? 'follow' });
    const key = new URL(url).pathname + (new URL(url).search || '');
    const r = routes[url] ?? routes[key] ?? routes['*'];
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    if (typeof r === 'function') return r(url, init);
    const res = new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html' } });
    Object.defineProperty(res, 'url', { value: r.finalUrl ?? url });
    return res;
  };
  return { wire, restore: () => { globalThis.fetch = real; } };
}
export function report(wire, label) {
  console.log(`\n===== ${label}: ${wire.length} request(s) that would have gone on the wire =====`);
  let prev = null;
  const counts = {};
  for (const w of wire) {
    counts[w.method + ' ' + w.url] = (counts[w.method + ' ' + w.url] || 0) + 1;
    console.log(`  +${String(prev === null ? 0 : w.t - prev).padStart(6)}ms  ${w.method} ${w.url}`);
    console.log(`            ua=${w.headers['user-agent']}  cookie=${w.headers.cookie ?? 'none'}  auth=${w.headers.authorization ?? 'none'}  redirect=${w.redirect}`);
    prev = w.t;
  }
  const dupes = Object.entries(counts).filter(([, n]) => n > 1);
  const gaps = wire.slice(1).map((w, i) => w.t - wire[i].t);
  console.log(`  -- distinct request lines: ${Object.keys(counts).length}; repeated: ${JSON.stringify(dupes)}`);
  console.log(`  -- inter-request gaps under 2000ms: ${gaps.filter((g) => g < 2000).length} of ${gaps.length}`);
  return { counts, dupes, gaps };
}
