import { Telescope } from 'lucide-react';
import CriteriaLegend from './CriteriaLegend';

/**
 * The table starts empty and stays that way until a real find clears
 * verification (finds-coord DECISIONS D6 -- no stub data, ever). This is
 * what ships first, so it has to read as intentional: it names the bar for
 * inclusion instead of showing a blank rectangle.
 */
const EmptyState = () => (
  <div className="text-center py-12 sm:py-16 px-4 sm:px-6 rounded-lg border border-dashed border-[#001F3F]/20 dark:border-white/20 space-y-8">
    <div className="space-y-3">
      <Telescope className="w-10 h-10 mx-auto text-[#001F3F]/40 dark:text-white/40" aria-hidden="true" />
      <p className="text-lg font-medium text-[#001F3F] dark:text-white">
        Nothing has cleared the bar yet.
      </p>
      <p className="text-[#001F3F]/70 dark:text-white/70 max-w-xl mx-auto">
        This list is checked, not curated by vibe. Every launch below will have passed all
        four checks first -- so right now it's empty, not broken.
      </p>
    </div>
    <div className="text-left max-w-2xl mx-auto">
      <CriteriaLegend />
    </div>
  </div>
);

export default EmptyState;
