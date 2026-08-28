// Small in-memory TTL cache. Used to avoid re-fetching robots.txt (and, one
// day, sitemaps) on every check within a run. TTL is a policy value and
// lives in config.ts, not here -- this module only knows how to expire
// entries once told when. A per-entry TTL override is supported because
// R2's rubric (§7) assigns a different TTL per verdict class (e.g. a DENY
// from a bot challenge is cached 7 days, an ALLOW only 6 hours) -- the
// caller decides which, this class just enforces whichever it's given.

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly store = new Map<string, Entry<V>>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMsOverride?: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + (ttlMsOverride ?? this.ttlMs) });
  }

  /** Fetch from cache, or compute + store on miss/expiry. */
  async getOrCompute(key: string, compute: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value);
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
