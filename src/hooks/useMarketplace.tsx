import { useEffect, useState } from 'react';
import {
  get_all_drugs,
  get_user_balance,
  ensure_marketplace_user,
  get_purchase_history_with_drugs,
} from '../lib/marketplace';
import type { Drug, PurchaseWithDrug } from '../types';

// Mock data for development/demo purposes (used when database is not yet set up)
const MOCK_DRUGS: Drug[] = [
  {
    id: '1',
    name: 'PainAway',
    description: 'Multi-spectrum analgesic and anti-inflammatory medication designed for comprehensive pain management. Effective for both chronic and acute pain conditions.',
    price: 5,
    stock: 250,
    diseases_treated: ['pain', 'inflammation', 'chronic pain', 'acute pain'],
    side_effects: ['stomach upset', 'dizziness', 'fatigue'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '2',
    name: 'MindEase',
    description: 'A powerful anxiolytic and antidepressant medication designed to restore emotional balance and mental clarity. Helps manage anxiety disorders and depression.',
    price: 20,
    stock: 250,
    diseases_treated: ['anxiety', 'depression', 'stress', 'panic disorder'],
    side_effects: ['drowsiness', 'nausea', 'headache'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '3',
    name: 'CogniFocus',
    description: 'Advanced cognitive enhancement medication for improved focus, attention, and mental performance. Particularly effective for ADHD and concentration difficulties.',
    price: 50,
    stock: 250,
    diseases_treated: ['ADHD', 'concentration issues', 'attention deficit', 'focus problems'],
    side_effects: ['insomnia', 'appetite loss', 'jitters'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '4',
    name: 'ImmuneBoost',
    description: 'Immunomodulatory medication to strengthen and support immune system function. Helps prevent frequent infections and supports overall immune health.',
    price: 75,
    stock: 250,
    diseases_treated: ['immune deficiency', 'frequent infections', 'weak immune system'],
    side_effects: ['fever', 'rash', 'muscle aches'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

/**
 * Custom hook for managing drug marketplace state
 *
 * Handles:
 * - Loading all drugs from database (with mock data fallback)
 * - Managing user token balance
 * - Loading purchase history
 * - Refreshing data after purchases
 *
 * @returns Marketplace data and loading state
 */
export function useMarketplace() {
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseWithDrug[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // Ensure user exists (creates with 100 tokens if new)
      await ensure_marketplace_user();

      // Load all data in parallel for performance
      const [drugsData, balanceData, historyData] = await Promise.all([
        get_all_drugs(),
        get_user_balance(),
        get_purchase_history_with_drugs(),
      ]);

      // Check if we got real data or if database is not set up
      if (drugsData.length === 0) {
        // Use mock data as fallback
        console.log('📦 Using mock data - database tables not yet created');
        setDrugs(MOCK_DRUGS);
        setUserBalance(100);
        setPurchaseHistory([]);
        setUsingMockData(true);
      } else {
        // Use real data from database
        setDrugs(drugsData);
        setUserBalance(balanceData);
        setPurchaseHistory(historyData);
        setUsingMockData(false);
      }
    } catch (error) {
      console.error('Error loading marketplace data:', error);
      // Fall back to mock data on error
      console.log('📦 Using mock data - database error');
      setDrugs(MOCK_DRUGS);
      setUserBalance(100);
      setPurchaseHistory([]);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadData();
  }, []);

  return {
    drugs,
    userBalance,
    purchaseHistory,
    loading,
    refreshData: loadData, // Expose refresh function for after purchases
    usingMockData, // Flag to indicate if using mock data
  };
}
