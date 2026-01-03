import { motion } from 'framer-motion';
import { usePageAnalytics } from '../hooks/usePageAnalytics';
import { useMarketplace } from '../hooks/useMarketplace';
import UserBalance from '../components/marketplace/UserBalance';
import DrugCard from '../components/marketplace/DrugCard';
import PurchaseHistory from '../components/marketplace/PurchaseHistory';
import VoiceAgentInterface from '../components/marketplace/VoiceAgentInterface';

/**
 * DrugMarketplace page - Voice agent-enabled pharmaceutical marketplace
 *
 * Features:
 * - Live drug inventory display with prices and stock
 * - User token balance (starts at 100 tokens)
 * - Voice agent interface for purchases
 * - Purchase history tracking
 * - Real-time updates after transactions
 *
 * Route: /spearfishing/voice-agent
 */
const DrugMarketplace = () => {
  const { pageId } = usePageAnalytics('Drug Marketplace - Voice Agent');
  const { drugs, userBalance, purchaseHistory, loading, refreshData, usingMockData } = useMarketplace();

  return (
    <div className="min-h-screen bg-white dark:bg-[#001F3F]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#001F3F] dark:text-white mb-4">
            Drug Marketplace
          </h1>
          <p className="text-lg sm:text-xl text-[#001F3F]/70 dark:text-white/70 max-w-2xl mx-auto">
            Voice-controlled pharmaceutical marketplace simulation
          </p>
          <p className="text-sm text-[#001F3F]/50 dark:text-white/50 mt-2">
            Start with 100 tokens • Varied pricing for experimentation
          </p>
        </motion.div>

        {/* Mock Data Notice */}
        {usingMockData && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-900 dark:text-blue-200">
              <strong>📦 Demo Mode:</strong> Currently showing mock data. To use real database, apply the migration in Supabase.
            </p>
          </div>
        )}

        {/* User Balance */}
        <UserBalance balance={userBalance} loading={loading} />

        {/* Voice Agent Interface */}
        <VoiceAgentInterface onPurchaseComplete={refreshData} />

        {/* Drug Grid */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-6">
            Available Drugs
          </h2>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-6 animate-pulse"
                >
                  <div className="h-6 bg-[#001F3F]/10 dark:bg-white/10 rounded w-1/3 mb-4" />
                  <div className="h-4 bg-[#001F3F]/10 dark:bg-white/10 rounded w-full mb-2" />
                  <div className="h-4 bg-[#001F3F]/10 dark:bg-white/10 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : drugs.length === 0 ? (
            <div className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-8 text-center">
              <p className="text-[#001F3F]/70 dark:text-white/70">
                No drugs available. Please run the database migration to seed initial data.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {drugs.map((drug, index) => (
                <DrugCard key={drug.id} drug={drug} index={index} />
              ))}
            </div>
          )}
        </div>

        {/* Purchase History */}
        <PurchaseHistory history={purchaseHistory} />

        {/* Debug Info (can be removed in production) */}
        {!loading && drugs.length > 0 && (
          <div className="mt-12 p-4 bg-[#001F3F]/5 dark:bg-white/5 rounded-lg border border-[#001F3F]/10 dark:border-white/10">
            <p className="text-xs text-[#001F3F]/50 dark:text-white/50 text-center">
              Page ID: {pageId || 'Loading...'} | {drugs.length} drugs loaded | Balance:{' '}
              {userBalance !== null ? `${userBalance} tokens` : 'N/A'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DrugMarketplace;
