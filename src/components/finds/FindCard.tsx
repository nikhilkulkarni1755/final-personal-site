import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { VisiblePublishedFind } from '../../../finds/types';
import CriteriaEvidence from './CriteriaEvidence';

interface FindCardProps {
  find: VisiblePublishedFind;
  index: number;
}

/**
 * A single published find, as it appears in the list. The name links
 * straight to the maker's own site with a plain, crawlable <a href> -- no
 * JS-only navigation, no rel="nofollow". This is the backlink the whole
 * page exists to give.
 *
 * `id={find.slug}` plus `scroll-mt-24` (same convention as ProjectCard) make
 * every entry addressable today at /interesting-finds#<slug>, and the
 * permalink icon links to its full page at /interesting-finds/<slug> -- the
 * canonical URL W3's schema declares. A maker who gets featured needs
 * something specific to link back to; the list alone isn't enough.
 */
const FindCard = ({ find, index }: FindCardProps) => {
  const formattedDate = new Date(find.found_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <motion.article
      id={find.slug}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="scroll-mt-24 bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-6 space-y-4"
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
          <span aria-hidden="true">&bull;</span>
          <Link
            to={`/interesting-finds/${find.slug}`}
            className="inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
          >
            <LinkIcon className="w-3.5 h-3.5" aria-hidden="true" />
            Permalink
          </Link>
        </div>
      </header>

      {find.why_interesting && (
        <blockquote className="border-l-2 border-[#001F3F]/20 dark:border-white/20 pl-4 italic text-[#001F3F]/80 dark:text-white/80">
          {find.why_interesting}
        </blockquote>
      )}

      <div className="pt-2 border-t border-[#001F3F]/10 dark:border-white/10">
        <CriteriaEvidence find={find} />
      </div>
    </motion.article>
  );
};

export default FindCard;
