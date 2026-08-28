import { ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Find } from './types';
import { CRITERIA } from './types';

interface FindCardProps {
  find: Find;
  index: number;
}

/**
 * A single find. The name links straight to the maker's own site with a
 * plain, crawlable <a href> -- no JS-only navigation, no rel="nofollow". This
 * is the backlink the whole page exists to give: the maker earns a real,
 * followable link back for building something genuinely interesting.
 */
const FindCard = ({ find, index }: FindCardProps) => {
  const formattedDate = new Date(find.foundAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
            href={find.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:opacity-70 transition-opacity"
          >
            {find.name}
            <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
          </a>
        </h3>
        <p className="text-[#001F3F]/70 dark:text-white/70">{find.tagline}</p>
        <div className="flex items-center gap-2 text-sm text-[#001F3F]/60 dark:text-white/60">
          <span>Found via {find.source}</span>
          <span aria-hidden="true">&bull;</span>
          <time dateTime={find.foundAt}>{formattedDate}</time>
        </div>
      </header>

      <dl className="space-y-2 pt-2 border-t border-[#001F3F]/10 dark:border-white/10">
        {CRITERIA.map(({ key, label }) => (
          <div key={key} className="text-sm">
            <dt className="font-semibold text-[#001F3F] dark:text-white">{label}</dt>
            <dd className="text-[#001F3F]/70 dark:text-white/70">{find.evidence[key]}</dd>
          </div>
        ))}
      </dl>
    </motion.article>
  );
};

export default FindCard;
