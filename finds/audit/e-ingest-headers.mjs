// What identity and what credentials do the ingest connectors put on the wire?
// bot.txt: "Sent byte-for-byte on every request this bot makes" and
// "Never sends a cookie, an Authorization header, or an API key."
import { installRecorder } from './recorder.mjs';
const json = (o) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const { wire } = installRecorder({ '*': json({ total_count: 0, items: [], nbPages: 1, hits: [], launches: [] }) });
process.env.GITHUB_TOKEN = 'ghp_THIS_IS_A_FAKE_TOKEN_FOR_THE_AUDIT';
const { fetchShowHN } = await import('../sources/hn.ts');
const { fetchUneedLaunches } = await import('../sources/uneed.ts');
const { fetchNewGithubRepos } = await import('../sources/github.ts');
await fetchShowHN(0);
await fetchUneedLaunches();
await fetchNewGithubRepos(new Date());
const PUBLISHED_UA = 'InterestingFindsBot/1.0 (+https://nikhilkulkarni1755.com/bot.txt)';
for (const w of wire) {
  console.log(`${w.method} ${w.url.split('?')[0]}`);
  console.log(`   user-agent    : ${w.headers['user-agent'] ?? '(none sent -- undici default goes on the wire)'}`);
  console.log(`   matches bot.txt: ${w.headers['user-agent'] === PUBLISHED_UA}`);
  console.log(`   authorization : ${w.headers.authorization ?? 'none'}`);
}
console.log(`\nrequests carrying the published UA: ${wire.filter(w => w.headers['user-agent'] === PUBLISHED_UA).length} of ${wire.length}`);
console.log(`requests carrying an Authorization header: ${wire.filter(w => w.headers.authorization).length} of ${wire.length}`);
