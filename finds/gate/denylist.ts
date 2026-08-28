// Manual denylist -- rubric §3.1 rule P0, the one signal that outranks
// every other rule, including robots.txt saying yes. §1.6(c): the escape
// hatch for "the ToS says no", "the owner emailed us", "Nikhil said don't".
// A human decides; the gate just obeys.
//
// Read fresh on every call, no caching, no restart required (§8.11) -- a
// domain can be added and takes effect on the very next check.

import { readFileSync } from 'node:fs';
import { GATE_CONFIG } from './config.ts';
import { registrableDomain } from './scope.ts';

export function isDenylisted(hostname: string): boolean {
  let text: string;
  try {
    text = readFileSync(GATE_CONFIG.denylistPath, 'utf-8');
  } catch {
    return false; // no denylist file yet -- nothing is denied
  }

  const target = registrableDomain(hostname);
  for (const raw of text.split('\n')) {
    const line = raw.split('#')[0].trim().toLowerCase();
    if (!line) continue;
    if (line === target) return true;
  }
  return false;
}
