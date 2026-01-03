import { motion } from 'framer-motion';
import { Pill, AlertCircle, Package, Heart } from 'lucide-react';
import type { Drug } from '../../types';

interface DrugCardProps {
  drug: Drug;
  index: number;
}

/**
 * DrugCard component - Displays detailed drug information
 *
 * Shows:
 * - Drug name and description
 * - Price and current stock
 * - Diseases treated (green pills)
 * - Side effects (orange pills)
 */
const DrugCard = ({ drug, index }: DrugCardProps) => {
  // Determine stock warning level
  const isLowStock = drug.stock < 50;
  const isOutOfStock = drug.stock === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className={`bg-white dark:bg-[#001F3F] border rounded-lg p-6 space-y-4 ${
        isOutOfStock
          ? 'border-red-300 dark:border-red-700 opacity-60'
          : 'border-[#001F3F]/10 dark:border-white/10'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1">
          <div className="p-3 bg-[#001F3F]/10 dark:bg-white/10 rounded-lg shrink-0">
            <Pill className="w-6 h-6 text-[#001F3F] dark:text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-[#001F3F] dark:text-white">
              {drug.name}
            </h3>
            <p className="text-sm text-[#001F3F]/70 dark:text-white/70 mt-1">
              {drug.description}
            </p>
          </div>
        </div>
      </div>

      {/* Price and Stock */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-2xl font-bold text-[#001F3F] dark:text-white">
            {drug.price}
          </span>
          <span className="text-sm text-[#001F3F]/70 dark:text-white/70">
            tokens
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <Package
            className={`w-4 h-4 ${
              isOutOfStock
                ? 'text-red-500'
                : isLowStock
                ? 'text-orange-500'
                : 'text-[#001F3F]/70 dark:text-white/70'
            }`}
          />
          <span
            className={`text-sm font-medium ${
              isOutOfStock
                ? 'text-red-500'
                : isLowStock
                ? 'text-orange-500'
                : 'text-[#001F3F]/70 dark:text-white/70'
            }`}
          >
            Stock: {drug.stock}
            {isOutOfStock && ' (Out of Stock!)'}
            {isLowStock && !isOutOfStock && ' (Low Stock)'}
          </span>
        </div>
      </div>

      {/* Diseases Treated */}
      <div>
        <h4 className="text-sm font-semibold text-[#001F3F] dark:text-white mb-2 flex items-center">
          <Heart className="w-4 h-4 mr-1" />
          Treats:
        </h4>
        <div className="flex flex-wrap gap-2">
          {drug.diseases_treated.map((disease) => (
            <span
              key={disease}
              className="px-2 py-1 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
            >
              {disease}
            </span>
          ))}
        </div>
      </div>

      {/* Side Effects */}
      <div>
        <h4 className="text-sm font-semibold text-[#001F3F] dark:text-white mb-2 flex items-center">
          <AlertCircle className="w-4 h-4 mr-1" />
          Side Effects:
        </h4>
        <div className="flex flex-wrap gap-2">
          {drug.side_effects.map((effect) => (
            <span
              key={effect}
              className="px-2 py-1 text-xs rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200"
            >
              {effect}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

export default DrugCard;
