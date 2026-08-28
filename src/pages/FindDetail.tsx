import { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import CriteriaEvidence from '../components/finds/CriteriaEvidence';
import { useFind } from '../components/finds/useFind';
import { usePageAnalytics } from '../hooks/usePageAnalytics';

const JSONLD_SCRIPT_ID = 'find-detail-jsonld';

/**
 * The canonical per-find page W3's schema declares: /interesting-finds/<slug>.
 * Added so a maker who gets featured has something specific to link back to
 * -- the list alone isn't (nikhilkulkarni1755.com/interesting-finds gives
 * every maker the same URL, which defeats the point of a backlink).
 *
 * A missing slug, a fetch failure, and an unpublished find (published_at
 * set back to NULL, row retained -- W11 supports this) all render the same
 * "not found" state below. RLS already filters unpublished rows out of what
 * anon can read, so this page cannot tell those three cases apart, and
 * shouldn't try to -- a stale link degrading to "not found" is correct,
 * not a bug to route around.
 */
const FindDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const { find, loading } = useFind(slug);

  usePageAnalytics(find ? find.name : 'Interesting Find');

  useEffect(() => {
    if (!find) return;

    const detailUrl = `https://nikhilkulkarni1755.com/interesting-finds/${find.slug}`;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = JSONLD_SCRIPT_ID;
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      '@id': `${detailUrl}#creativework`,
      name: find.name,
      url: detailUrl,
      datePublished: find.published_at,
      citation: find.citations.map((c) => c.url),
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById(JSONLD_SCRIPT_ID)?.remove();
    };
  }, [find]);

  if (loading) {
    return <div className="min-h-screen" />;
  }

  if (!find) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-[#001F3F] dark:text-white">Find Not Found</h1>
          <p className="text-[#001F3F]/70 dark:text-white/70 max-w-md mx-auto">
            Either this link is wrong, or the find behind it is no longer published.
          </p>
          <Link
            to="/interesting-finds"
            className="inline-flex items-center space-x-2 text-[#001F3F] dark:text-white hover:opacity-70 transition-opacity"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Interesting Finds</span>
          </Link>
        </div>
      </div>
    );
  }

  const formattedDate = new Date(find.found_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
          <Link
            to="/interesting-finds"
            className="inline-flex items-center space-x-2 text-[#001F3F] dark:text-white hover:opacity-70 transition-opacity mb-8"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Interesting Finds</span>
          </Link>
        </motion.div>

        <motion.header
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8 space-y-4"
        >
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#001F3F] dark:text-white">
            <a
              href={find.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 hover:opacity-70 transition-opacity"
            >
              {find.name}
              <ExternalLink className="w-6 h-6 shrink-0" aria-hidden="true" />
            </a>
          </h1>
          {find.tagline && (
            <p className="text-lg text-[#001F3F]/70 dark:text-white/70">{find.tagline}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#001F3F]/60 dark:text-white/60">
            <span>Found via {find.source_labels.join(', ')}</span>
            <span aria-hidden="true">&bull;</span>
            <time dateTime={find.found_at}>{formattedDate}</time>
          </div>
        </motion.header>

        {find.why_interesting && (
          <motion.blockquote
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="border-l-2 border-[#001F3F]/20 dark:border-white/20 pl-4 italic text-lg text-[#001F3F]/80 dark:text-white/80 mb-8"
          >
            {find.why_interesting}
          </motion.blockquote>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="pt-6 border-t border-[#001F3F]/10 dark:border-white/10"
        >
          <h2 className="text-xl font-bold text-[#001F3F] dark:text-white mb-4">Why it's here</h2>
          <CriteriaEvidence find={find} />
        </motion.div>
      </article>
    </div>
  );
};

export default FindDetail;
