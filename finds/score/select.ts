/**
 * Choosing the 2-3 that go in a day's digest.
 *
 * This is not "take the top three scores". A digest is a thing someone reads
 * in one sitting, so the unit of quality is the DAY, not the find:
 *
 *   FEWER, BETTER. There is a floor and no quota. A day with one thing worth
 *   sending sends one. A day with nothing worth sending sends nothing and says
 *   so -- that is a correct output, not a failure, and it is the only way the
 *   email stays worth opening. Padding to three teaches the reader to skim.
 *
 *   NO DAY IS ONE PLATFORM'S FRONT PAGE. R1 measured Peerlist as a ~286/week
 *   Monday drop against Show HN's ~134/day, so on a Monday an unconstrained
 *   ranking would hand back three Peerlist launches by sheer supply. At most
 *   two picks may share a source.
 *
 *   NO DAY IS THE SAME IDEA THREE TIMES. Two AI code-review tools launching on
 *   the same morning are one find, not two.
 *
 *   NOTHING IS SENT TWICE. That rule lives in `finds_undigested_candidates`
 *   (W3), which excludes a candidate only once it is in a SENT digest -- a
 *   failed send does not burn the finds Nikhil never saw. Callers select from
 *   that view; this file does not re-implement the rule.
 *
 * Every rejection is returned with its reason. A selector that silently drops
 * 280 candidates is unauditable, and on a Monday that is exactly what it does.
 */

import type { Criterion, VerdictScore } from '../types.ts';
import type { C1Status } from './types.ts';
import { RUBRIC_VERSION } from './rubric.ts';

/** The most a digest may carry. Not a target -- a ceiling. */
export const MAX_PICKS = 3;
/** No source may supply a whole day. */
export const MAX_PER_SOURCE = 2;
/**
 * How many of C2/C3/C4 must be POSITIVELY supported (>=2) for a find to clear
 * the floor. Two of three: one supported criterion is a coincidence, three is a
 * bar almost nothing clears, and C1 is handled separately because it is a gate
 * rather than a contributor.
 */
const MIN_SUPPORTED_CRITERIA = 2;
/** Distinctive terms two finds may share before they are the same find. */
const SAME_PROBLEM_SHARED_TERMS = 2;

const ALL_CRITERIA: readonly Criterion[] = ['C1', 'C2', 'C3', 'C4'];

/** Marketing filler. A term has to distinguish products to count as one. */
const FILLER = new Set([
  'your', 'with', 'that', 'this', 'from', 'into', 'more', 'than', 'best', 'better',
  'easy', 'easily', 'simple', 'simply', 'fast', 'faster', 'free', 'open', 'build',
  'built', 'builder', 'make', 'made', 'maker', 'tool', 'tools', 'app', 'apps',
  'platform', 'powered', 'using', 'without', 'every', 'anyone', 'people', 'team',
  'teams', 'work', 'works', 'new', 'first', 'ever', 'just', 'like', 'help', 'helps',
  'time', 'times', 'good', 'great', 'modern', 'smart', 'next', 'today', 'launch',
]);

function distinctiveTerms(...parts: (string | null)[]): Set<string> {
  const terms = new Set<string>();
  for (const part of parts) {
    for (const raw of (part ?? '').toLowerCase().match(/[a-z][a-z0-9+#.-]{3,}/g) ?? []) {
      const token = raw.replace(/[.\-]+$/, '');
      if (token.length >= 4 && !FILLER.has(token)) terms.add(token);
    }
  }
  return terms;
}

function sharedTerms(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((term) => b.has(term));
}

/* -------------------------------------------------------------------------- */
/* input and output                                                            */
/* -------------------------------------------------------------------------- */

/** One scored candidate, as selection needs to see it. */
export interface SelectionCandidate {
  candidate_id: string;
  name: string;
  tagline: string | null;
  product_url: string;
  /** The crawl generation these scores were computed from. */
  evidence_run_id: string;
  /** `finds_sources.slug` for every platform this product was sighted on. */
  source_slugs: string[];
  /**
   * C1-C4. A MISSING criterion means unscoreable, not zero. Nothing here
   * substitutes a number for a non-evaluation (D6) -- an incompletely scored
   * candidate is not comparable to a fully scored one and is set aside, with
   * its reason recorded, rather than ranked as if it had lost.
   */
  scores: Partial<Record<Criterion, VerdictScore>>;
  c1_status?: C1Status;
  first_seen_at: string;
}

export type RejectionReason =
  /**
   * Some criterion scored 0: the evidence CONTRADICTS it. Disqualifying on any
   * of the four, not only C1. A 0 is not "did badly", it is "we hold evidence
   * against this" -- the product's claims are contradicted, or nobody can use
   * it, or its category is crowded by its own account, or its only agent
   * surface is dead. Each of those is a reason not to send it, and the
   * criterion is named in the detail.
   */
  | 'contradicted'
  /** Not all four criteria were scoreable, so the find is not comparable. */
  | 'incomplete_scores'
  /** Scored, and the evidence simply does not support enough of it. */
  | 'below_quality_floor'
  /** Good enough, but its platform already has two picks today. */
  | 'source_quota'
  /** Good enough, but it is the same idea as something already picked today. */
  | 'same_problem_space'
  /** Good enough, and the day was already full. First one out tomorrow. */
  | 'day_full';

export interface Pick {
  candidate_id: string;
  name: string;
  product_url: string;
  evidence_run_id: string;
  source_slugs: string[];
  scores: Record<Criterion, VerdictScore>;
  c1_status?: C1Status;
  /** Why this one, in one line. */
  why: string;
}

export interface Rejection {
  candidate_id: string;
  name: string;
  reason: RejectionReason;
  detail: string;
}

export interface Selection {
  date: string;
  rubric_version: string;
  picks: Pick[];
  /** Every candidate considered and not picked, with the reason. */
  rejected: Rejection[];
  /** One line fit to log, and to explain an empty day without apologising. */
  summary: string;
}

/* -------------------------------------------------------------------------- */
/* selection                                                                   */
/* -------------------------------------------------------------------------- */

function total(scores: Record<Criterion, VerdictScore>): number {
  return ALL_CRITERIA.reduce((sum, criterion) => sum + scores[criterion], 0);
}

function clearlySupported(scores: Record<Criterion, VerdictScore>): number {
  return ALL_CRITERIA.filter((criterion) => scores[criterion] === 3).length;
}

/**
 * Pick a day's digest.
 *
 * `candidates` must already be restricted to `finds_undigested_candidates` --
 * the never-twice rule lives in that view and is not re-implemented here.
 *
 * Deterministic: the same candidates in any order produce the same selection.
 * Ties break on total, then on how many criteria were CLEARLY supported (a 3
 * beats two 2s, because it means we actually measured something), then on the
 * candidate first seen earlier, then on id. No clock, no randomness.
 */
export function selectForDay(date: string, candidates: readonly SelectionCandidate[]): Selection {
  const rejected: Rejection[] = [];
  const reject = (candidate: SelectionCandidate, reason: RejectionReason, detail: string): void => {
    rejected.push({ candidate_id: candidate.candidate_id, name: candidate.name, reason, detail });
  };

  const eligible: { candidate: SelectionCandidate; scores: Record<Criterion, VerdictScore>; supported: number }[] = [];

  for (const candidate of candidates) {
    const missing = ALL_CRITERIA.filter((criterion) => candidate.scores[criterion] === undefined);
    if (missing.length > 0) {
      reject(
        candidate,
        'incomplete_scores',
        `${missing.join(', ')} could not be scored from this crawl generation, so the find is not ` +
          'comparable with fully scored ones. Not a low score -- a non-evaluation.',
      );
      continue;
    }
    const scores = Object.fromEntries(
      ALL_CRITERIA.map((criterion) => [criterion, candidate.scores[criterion]!]),
    ) as Record<Criterion, VerdictScore>;

    const contradicted = ALL_CRITERIA.filter((criterion) => scores[criterion] === 0);
    if (contradicted.length > 0) {
      reject(
        candidate,
        'contradicted',
        `${contradicted.join(', ')} scored 0: we hold evidence AGAINST ${contradicted.length > 1 ? 'those criteria' : 'that criterion'}, ` +
          'not merely an absence of evidence for it. Disqualifying however well it scores elsewhere' +
          (contradicted.includes('C1') ? ' -- and truth is the first criterion.' : '.'),
      );
      continue;
    }

    const supported = (['C2', 'C3', 'C4'] as const).filter((criterion) => scores[criterion] >= 2).length;
    if (supported < MIN_SUPPORTED_CRITERIA) {
      reject(
        candidate,
        'below_quality_floor',
        `Only ${supported} of C2/C3/C4 have evidence positively supporting them (need ` +
          `${MIN_SUPPORTED_CRITERIA}). We did not learn enough about this to be worth his attention.`,
      );
      continue;
    }
    eligible.push({ candidate, scores, supported });
  }

  eligible.sort((a, b) => {
    const byTotal = total(b.scores) - total(a.scores);
    if (byTotal !== 0) return byTotal;
    const byClear = clearlySupported(b.scores) - clearlySupported(a.scores);
    if (byClear !== 0) return byClear;
    const bySeen = a.candidate.first_seen_at.localeCompare(b.candidate.first_seen_at);
    if (bySeen !== 0) return bySeen;
    return a.candidate.candidate_id.localeCompare(b.candidate.candidate_id);
  });

  const picks: Pick[] = [];
  const perSource = new Map<string, number>();
  const pickedTerms: { name: string; terms: Set<string> }[] = [];

  for (const { candidate, scores } of eligible) {
    if (picks.length >= MAX_PICKS) {
      reject(candidate, 'day_full', `The day already carries ${MAX_PICKS} finds; this one keeps its place in the queue.`);
      continue;
    }

    // Rejected only when EVERY platform it appeared on has filled its quota. A
    // launch cross-posted to a saturated and an unsaturated source still brings
    // breadth -- R1's point that "a launch appearing on three platforms in one
    // day is part of the story" -- and the digest shows every one of its labels.
    const saturated = candidate.source_slugs.filter((slug) => (perSource.get(slug) ?? 0) >= MAX_PER_SOURCE);
    if (saturated.length > 0 && saturated.length === candidate.source_slugs.length) {
      reject(
        candidate,
        'source_quota',
        `${saturated.join(', ')} already supplied ${MAX_PER_SOURCE} of today's finds. A digest that is one ` +
          "platform's front page is not a digest.",
      );
      continue;
    }

    const terms = distinctiveTerms(candidate.name, candidate.tagline);
    const clash = pickedTerms.find((picked) => sharedTerms(picked.terms, terms).length >= SAME_PROBLEM_SHARED_TERMS);
    if (clash) {
      reject(
        candidate,
        'same_problem_space',
        `Shares ${sharedTerms(clash.terms, terms).join(', ')} with ${JSON.stringify(clash.name)}, already ` +
          'picked today. Two takes on one problem are one find.',
      );
      continue;
    }

    for (const slug of candidate.source_slugs) perSource.set(slug, (perSource.get(slug) ?? 0) + 1);
    pickedTerms.push({ name: candidate.name, terms });
    picks.push({
      candidate_id: candidate.candidate_id,
      name: candidate.name,
      product_url: candidate.product_url,
      evidence_run_id: candidate.evidence_run_id,
      source_slugs: candidate.source_slugs,
      scores,
      c1_status: candidate.c1_status,
      why:
        `C1 ${candidate.c1_status ?? 'unknown'} (${scores.C1}), C2 ${scores.C2}, C3 ${scores.C3}, ` +
        `C4 ${scores.C4} -- total ${total(scores)} of 12 on evidential support.`,
    });
  }

  const tally = (reason: RejectionReason): number => rejected.filter((r) => r.reason === reason).length;
  const summary =
    picks.length === 0
      ? `${date}: nothing worth sending. ${candidates.length} candidate(s) considered -- ` +
        `${tally('contradicted')} contradicted, ${tally('below_quality_floor')} below the quality floor, ` +
        `${tally('incomplete_scores')} not fully scoreable. Sending no digest is the correct output; a digest ` +
        'of mediocre finds is worth less than no digest.'
      : `${date}: ${picks.length} of ${candidates.length} candidate(s) selected, from ` +
        `${new Set(picks.flatMap((p) => p.source_slugs)).size} source(s). ` +
        `${rejected.length} not selected (${tally('contradicted')} contradicted, ` +
        `${tally('below_quality_floor')} below the floor, ${tally('incomplete_scores')} not fully scoreable, ` +
        `${tally('source_quota')} source quota, ${tally('same_problem_space')} same problem space, ` +
        `${tally('day_full')} queued for another day).`;

  return { date, rubric_version: RUBRIC_VERSION, picks, rejected, summary };
}
