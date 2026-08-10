import { GitMerge, ExternalLink } from 'lucide-react';
import type { Contribution } from '../types';

const ContributionCard = ({ contribution }: { contribution: Contribution }) => (
  <div className="h-full bg-white dark:bg-[#001F3F]/50 border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-4 hover:shadow-xl transition-shadow duration-300 flex flex-col">
    <div className="text-xs text-[#001F3F]/50 dark:text-white/50 mb-0.5">
      {contribution.org}
    </div>
    <h3 className="text-lg font-bold text-[#001F3F] dark:text-white mb-2">
      {contribution.repo}
    </h3>
    <div className="inline-flex items-center gap-1.5 self-start px-2 py-0.5 mb-3 rounded bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white text-xs">
      <GitMerge className="w-3.5 h-3.5" />
      <span>
        {contribution.merged} PR{contribution.merged > 1 ? 's' : ''} merged
      </span>
    </div>
    <p className="text-sm text-[#001F3F]/70 dark:text-white/70 mb-3 line-clamp-3 flex-grow">
      {contribution.highlight}
    </p>
    <div className="flex flex-wrap gap-1.5 mb-3">
      {contribution.techStack.slice(0, 3).map((tech) => (
        <span
          key={tech}
          className="px-2 py-0.5 bg-[#001F3F]/10 dark:bg-white/10 text-[#001F3F] dark:text-white rounded text-xs"
        >
          {tech}
        </span>
      ))}
    </div>
    <a
      href={contribution.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center space-x-2 px-4 py-2 bg-[#001F3F] dark:bg-white text-white dark:text-[#001F3F] rounded-lg hover:opacity-80 transition-all duration-300 text-sm"
    >
      <span>View PR{contribution.merged > 1 ? 's' : ''}</span>
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  </div>
);

export default ContributionCard;
