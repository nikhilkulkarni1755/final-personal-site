import { ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import type { VisiblePublishedFind, PublishedCitation } from '../../../finds/types';
import { CRITERION_ORDER, CRITERION_LABELS, SCORE_LABELS } from './criteria';

interface FindCardProps {
  find: VisiblePublishedFind;
  index: number;
}

const SCORE_BY_CRITERION: Record<string, keyof VisiblePublishedFind> = {
  C1: 'score_claim_verified',
  C2: 'score_rare_problem',
  C3: 'score_anyone_can_use',
  C4: 'score_agentic_friendly',
};

/**
 * A single published find. The name links straight to the maker's own site
 * with a plain, crawlable <a href> -- no JS-only navigation, no
 * rel="nofollow". This is the backlink the whole page exists to give.
 *
 * "Why it was picked" is `citations`: the public projection of the evidence
 * behind each C1-C4 score (finds_published.citations, DEPENDENCIES.md).
 * Rendered verbatim per D7 -- a score alone is never shown without what
 * backs it.
 */
const FindCard = ({ find, index }: FindCardProps) => {
  const formattedDate = new Date(find.found_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const citationsByCriterion = (criterion: string): PublishedCitation[] =>
    find.citations.filter((c) => c.criterion === criterion);

  return (
    <motion.article
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-6 space-y-4"
    >
      <header className="space-y-2">
        <h3 className="text-xl sm:text-2xl font-bold text-[#001F3F] dark:text-white">
          <a
            href={find.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:opacity-70 transition-opacity"
          >
            {find.name}
            <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
          </a>
        </h3>
        {find.tagline && <p className="text-[#001F3F]/70 dark:text-white/70">{find.tagline}</p>}
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#001F3F]/60 dark:text-white/60">
          <span>Found via {find.source_labels.join(', ')}</span>
          <span aria-hidden="true">&bull;</span>
          <time dateTime={find.found_at}>{formattedDate}</time>
        </div>
      </header>

      {find.why_interesting && (
        <blockquote className="border-l-2 border-[#001F3F]/20 dark:border-white/20 pl-4 italic text-[#001F3F]/80 dark:text-white/80">
          {find.why_interesting}
        </blockquote>
      )}

      <dl className="space-y-3 pt-2 border-t border-[#001F3F]/10 dark:border-white/10">
        {CRITERION_ORDER.map((criterion) => {
          const citations = citationsByCriterion(criterion);
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
                      {citation.stance === 'contradicts' ? 'Contradicts: ' : 'Supports: '}
                    </span>
                    {citation.quote ? <span>&ldquo;{citation.quote}&rdquo;</span> : <span>Measured directly</span>}{' '}
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
    </motion.article>
  );
};

export default FindCard;
