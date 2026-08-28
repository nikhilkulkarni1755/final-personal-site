import { useEffect } from 'react';
import { motion } from 'framer-motion';
import CriteriaLegend from '../components/finds/CriteriaLegend';
import EmptyState from '../components/finds/EmptyState';
import FindCard from '../components/finds/FindCard';
import { useFinds } from '../components/finds/useFinds';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import ActiveViewers from '../components/ActiveViewers';
import PageStats from '../components/PageStats';
import LikeButton from '../components/LikeButton';

const PAGE_URL = 'https://nikhilkulkarni1755.com/interesting-finds';
const JSONLD_SCRIPT_ID = 'interesting-finds-jsonld';

const InterestingFinds = () => {
  const { finds, loading } = useFinds();

  // Track page analytics
  const { pageId, activeUsers, analytics } = usePageAnalytics('Interesting Finds');

  // ItemList structured data for a curated list -- the schema.org type built
  // for exactly this shape. numberOfItems and itemListElement always reflect
  // what's actually loaded, empty list included, so this never advertises
  // finds that don't exist. No page in this codebase manages <head> tags yet,
  // so this is scoped to this file rather than inventing a shared mechanism.
  useEffect(() => {
    if (loading) return;

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = JSONLD_SCRIPT_ID;
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      '@id': `${PAGE_URL}#list`,
      name: 'Interesting Finds',
      description:
        'Product launches Nikhil Kulkarni found genuinely interesting, verified against four criteria before being listed.',
      url: PAGE_URL,
      numberOfItems: finds.length,
      itemListElement: finds.map((find, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: find.url,
        name: find.name,
      })),
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById(JSONLD_SCRIPT_ID)?.remove();
    };
  }, [finds, loading]);

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#001F3F] dark:text-white mb-4">
            Interesting Finds
          </h1>
          <p className="text-lg sm:text-xl text-[#001F3F]/70 dark:text-white/70 max-w-2xl mx-auto">
            Launches I dug into and found genuinely worth your time -- checked before they
            earned a spot here, not just liked.
          </p>
        </motion.div>

        {/* Criteria */}
        <section className="mb-16" aria-labelledby="criteria-heading">
          <h2
            id="criteria-heading"
            className="text-2xl sm:text-3xl font-bold text-[#001F3F] dark:text-white mb-6"
          >
            How a find earns its spot
          </h2>
          <CriteriaLegend />
        </section>

        {/* Finds */}
        <section aria-labelledby="finds-heading">
          <h2
            id="finds-heading"
            className="text-2xl sm:text-3xl font-bold text-[#001F3F] dark:text-white mb-6"
          >
            Finds
          </h2>
          {!loading && (finds.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {finds.map((find, index) => (
                <FindCard key={find.id} find={find} index={index} />
              ))}
            </div>
          ))}
        </section>

        {/* Analytics Section */}
        <div className="mt-16">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-white/50 dark:bg-[#001F3F]/30 border border-[#001F3F]/10 dark:border-white/10 rounded-lg">
            <div className="flex flex-col sm:flex-row items-center gap-4 flex-1">
              <ActiveViewers count={activeUsers} />
              <PageStats
                viewCount={analytics?.view_count}
                likeCount={analytics?.like_count}
              />
            </div>
            <LikeButton pageId={pageId} likeCount={analytics?.like_count} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterestingFinds;
