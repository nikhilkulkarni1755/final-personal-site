import { Coins } from 'lucide-react';

interface UserBalanceProps {
  balance: number | null;
  loading: boolean;
}

/**
 * UserBalance component - Displays user's current token balance
 *
 * Features:
 * - Large, prominent display of token count
 * - Loading skeleton state
 * - Gradient background for visual emphasis
 */
const UserBalance = ({ balance, loading }: UserBalanceProps) => {
  if (loading) {
    return (
      <div className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-6 mb-8">
        <div className="animate-pulse flex items-center space-x-4">
          <div className="h-12 w-12 bg-[#001F3F]/10 dark:bg-white/10 rounded-lg" />
          <div className="flex-1">
            <div className="h-4 bg-[#001F3F]/10 dark:bg-white/10 rounded w-1/4 mb-2" />
            <div className="h-8 bg-[#001F3F]/10 dark:bg-white/10 rounded w-1/3" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-[#001F3F] to-[#003366] dark:from-white/10 dark:to-white/5 border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-6 mb-8">
      <div className="flex items-center space-x-4">
        <div className="p-3 bg-white/10 rounded-lg">
          <Coins className="w-8 h-8 text-white" />
        </div>
        <div>
          <p className="text-sm text-white/70">Available Tokens</p>
          <p className="text-3xl font-bold text-white">
            {balance !== null ? balance : '---'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default UserBalance;
