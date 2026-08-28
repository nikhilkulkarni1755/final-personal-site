import type { VisiblePublishedFind, PublishedCitation } from '../../../finds/types';
import { CRITERION_ORDER, CRITERION_LABELS, SCORE_LABELS } from './criteria';

const SCORE_BY_CRITERION: Record<string, keyof VisiblePublishedFind> = {
  C1: 'score_claim_verified',
  C2: 'score_rare_problem',
  C3: 'score_anyone_can_use',
  C4: 'score_agentic_friendly',
};

interface CriteriaEvidenceProps {
  find: VisiblePublishedFind;
}

/**
 * The four C1-C4 scores plus the citations that justify them --
 * finds_published.citations, the public projection of the private evidence
 * (DEPENDENCIES.md). Shared by FindCard and FindDetail so the one tricky
 * rendering rule lives in one place: a citation can have no `quote` either
 * because it is a measured behaviour or because its source's USE rights
 * forbid a public excerpt (W11) -- two different reasons, same shape, so
 * this never guesses which one applies. It keeps the stance and the link
 * and drops only the quote, never an empty box.
 */
const CriteriaEvidence = ({ find }: CriteriaEvidenceProps) => {
  const citationsFor = (criterion: string): PublishedCitation[] =>
    find.citations.filter((c) => c.criterion === criterion);

  return (
    <dl className="space-y-3">
      {CRITERION_ORDER.map((criterion) => {
        const citations = citationsFor(criterion);
        const score = find[SCORE_BY_CRITERION[criterion]] as 0 | 1 | 2 | 3;
        return (
          <div key={criterion} className="text-sm">
            <dt className="font-semibold text-[#001F3F] dark:text-white">
              {CRITERION_LABELS[criterion]}
              <span className="ml-2 font-normal text-[#001F3F]/60 dark:text-white/60">
                {SCORE_LABELS[score]}
              </span>
            </dt>
            <dd className="mt-1 space-y-1.5">
              {citations.length === 0 && (
                <span className="text-[#001F3F]/50 dark:text-white/50">No citation on file</span>
              )}
              {citations.map((citation, i) => (
                <div key={i} className="text-[#001F3F]/70 dark:text-white/70">
                  <span className="font-medium">
                    {citation.stance === 'contradicts' ? 'Contradicts' : 'Supports'}:
                  </span>{' '}
                  {citation.quote && <span>&ldquo;{citation.quote}&rdquo; </span>}
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-70 transition-opacity"
                  >
                    source
                  </a>
                </div>
              ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

export default CriteriaEvidence;
