import { ShoppingCart, Calendar, Package } from 'lucide-react';
import type { PurchaseWithDrug } from '../../types';

interface PurchaseHistoryProps {
  history: PurchaseWithDrug[];
}

/**
 * PurchaseHistory component - Displays user's past drug purchases
 *
 * Shows:
 * - Drug name
 * - Quantity purchased
 * - Total cost in tokens
 * - Purchase date
 */
const PurchaseHistory = ({ history }: PurchaseHistoryProps) => {
  if (history.length === 0) {
    return null;
  }

  return (
    <div className="mt-12">
      <h2 className="text-2xl font-bold text-[#001F3F] dark:text-white mb-6 flex items-center">
        <ShoppingCart className="w-6 h-6 mr-2" />
        Purchase History
      </h2>

      <div className="space-y-4">
        {history.map((purchase) => (
          <div
            key={purchase.id}
            className="bg-white dark:bg-[#001F3F] border border-[#001F3F]/10 dark:border-white/10 rounded-lg p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-[#001F3F] dark:text-white">
                  {purchase.drugs?.name || 'Unknown Drug'}
                </h3>
                <div className="flex items-center space-x-4 mt-2 text-sm text-[#001F3F]/70 dark:text-white/70">
                  <span className="flex items-center">
                    <Package className="w-4 h-4 mr-1" />
                    Quantity: {purchase.quantity}
                  </span>
                  <span className="font-medium">
                    Total: {purchase.total_cost} tokens
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2 text-sm text-[#001F3F]/70 dark:text-white/70">
                <Calendar className="w-4 h-4" />
                <span>{new Date(purchase.purchase_date).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PurchaseHistory;
