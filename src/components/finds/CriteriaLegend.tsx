import { CheckCircle2, Gem, Users, Bot } from 'lucide-react';

const CRITERIA_COPY = [
  {
    icon: CheckCircle2,
    label: 'Claim verified true',
    detail: 'What the maker advertises is checked against what the product actually does, not taken on faith.',
  },
  {
    icon: Gem,
    label: 'Solves a rare problem',
    detail: 'Not another to-do list or wrapper. It addresses something most tools skip.',
  },
  {
    icon: Users,
    label: 'Anyone can use it',
    detail: 'No gated waitlist, no "talk to sales" wall. A real person can pick it up today.',
  },
  {
    icon: Bot,
    label: 'Agentic / MCP friendly',
    detail: 'Built with agents in mind -- an API, an MCP server, or a surface an agent can actually drive.',
  },
] as const;

/**
 * The four fixed criteria every find is checked against (finds-coord/README.md
 * VERIFY step). Shared between the populated list and the empty state so the
 * bar for inclusion is real content on the page from day one, not something
 * that only appears once entries exist.
 */
const CriteriaLegend = () => (
  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
    {CRITERIA_COPY.map(({ icon: Icon, label, detail }) => (
      <div
        key={label}
        className="flex items-start gap-3 p-4 rounded-lg border border-[#001F3F]/10 dark:border-white/10 bg-white/50 dark:bg-[#001F3F]/30"
      >
        <Icon className="w-5 h-5 mt-0.5 shrink-0 text-[#001F3F] dark:text-white" aria-hidden="true" />
        <div>
          <dt className="font-semibold text-[#001F3F] dark:text-white">{label}</dt>
          <dd className="text-sm text-[#001F3F]/70 dark:text-white/70 mt-1">{detail}</dd>
        </div>
      </div>
    ))}
  </dl>
);

export default CriteriaLegend;
