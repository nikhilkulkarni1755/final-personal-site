// Credential loading for the Peerlist comment transport. Reads exactly one
// secret -- the `token` cookie -- per R1-sources.md §1.7's finding that it
// is necessary AND sufficient to authenticate /api/v1/**; none of the other
// seven cookies in the jar are sent anywhere. Smaller blast radius if this
// leaks or the file is misread.
//
// Never commit, never echo, never log the value itself (finds-coord/
// DECISIONS.md D3). Absent or unreadable credential is a loud, specific,
// non-zero-exit failure -- never a silent no-op (D6).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_COOKIES_PATH = resolve(homedir(), 'nsk1755/finds-coord/peerlist-cookies.json');

interface PeerlistCookieJar {
  cookies: Record<string, string>;
}

/**
 * Reads the Peerlist `token` cookie from the jar Nikhil supplied (see
 * finds-coord's setup notes: chmod 600, outside the repo, expires
 * 2026-09-27 per DECISIONS D3). Override the path with PEERLIST_COOKIES_PATH
 * for testing; production use should rely on the default.
 */
export function readPeerlistToken(): string {
  const path = process.env.PEERLIST_COOKIES_PATH ?? DEFAULT_COOKIES_PATH;

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read the Peerlist credential: no file at ${path} (${(err as Error).message}). ` +
        'This is a hard stop, not a skip -- W9 cannot post without Nikhil\'s session. ' +
        'See finds-coord/README.md for where the cookie jar lives.',
    );
  }

  let jar: PeerlistCookieJar;
  try {
    jar = JSON.parse(raw) as PeerlistCookieJar;
  } catch {
    throw new Error(`Cannot parse the Peerlist credential file at ${path}: not valid JSON.`);
  }

  const token = jar.cookies?.token;
  if (!token) {
    throw new Error(
      `The Peerlist credential file at ${path} has no "cookies.token" entry. ` +
        'Per R1-sources.md §1.7, `token` is the only cookie that authenticates ' +
        '/api/v1/**; without it there is nothing to post with.',
    );
  }
  return token;
}
