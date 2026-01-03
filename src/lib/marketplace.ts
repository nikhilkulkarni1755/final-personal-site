import { supabase } from './supabase';
import { getVisitorId } from './analytics-utils';
import type { Drug, MarketplaceUser, Purchase, PurchaseWithDrug } from '../types';

// Type bypass for marketplace tables (will exist after migration)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ============================================================================
// DRUG INFORMATION FUNCTIONS
// ============================================================================

/**
 * Gets the price of a specific drug by name
 */
export async function get_price(drugName: string): Promise<number | null> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('price')
      .ilike('name', drugName)
      .single();

    if (error) {
      console.error('Error getting drug price:', error);
      return null;
    }

    return data?.price ?? null;
  } catch (error) {
    console.error('Error in get_price:', error);
    return null;
  }
}

/**
 * Gets the side effects of a specific drug by name
 */
export async function get_side_effects(drugName: string): Promise<string[] | null> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('side_effects')
      .ilike('name', drugName)
      .single();

    if (error) {
      console.error('Error getting side effects:', error);
      return null;
    }

    return data?.side_effects ?? null;
  } catch (error) {
    console.error('Error in get_side_effects:', error);
    return null;
  }
}

/**
 * Gets the diseases treated by a specific drug by name
 */
export async function get_diseases_treated(drugName: string): Promise<string[] | null> {
  try {
    const { data, error} = await db
      .from('drugs')
      .select('diseases_treated')
      .ilike('name', drugName)
      .single();

    if (error) {
      console.error('Error getting diseases treated:', error);
      return null;
    }

    return data?.diseases_treated ?? null;
  } catch (error) {
    console.error('Error in get_diseases_treated:', error);
    return null;
  }
}

/**
 * Gets the current stock level of a specific drug by name
 */
export async function get_drug_stock(drugName: string): Promise<number | null> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('stock')
      .ilike('name', drugName)
      .single();

    if (error) {
      console.error('Error getting drug stock:', error);
      return null;
    }

    return data?.stock ?? null;
  } catch (error) {
    console.error('Error in get_drug_stock:', error);
    return null;
  }
}

/**
 * Gets all available drugs in the marketplace
 */
export async function get_all_drugs(): Promise<Drug[]> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error getting all drugs:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in get_all_drugs:', error);
    return [];
  }
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

/**
 * Lists all drugs that have a specific side effect
 */
export async function list_drugs_by_side_effect(sideEffect: string): Promise<Drug[]> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('*')
      .contains('side_effects', [sideEffect]);

    if (error) {
      console.error('Error listing drugs by side effect:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in list_drugs_by_side_effect:', error);
    return [];
  }
}

/**
 * Lists all drugs that treat a specific disease
 */
export async function list_drugs_by_disease(disease: string): Promise<Drug[]> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('*')
      .contains('diseases_treated', [disease]);

    if (error) {
      console.error('Error listing drugs by disease:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in list_drugs_by_disease:', error);
    return [];
  }
}

/**
 * Searches drugs by name (case-insensitive partial match)
 */
export async function search_drugs(searchTerm: string): Promise<Drug[]> {
  try {
    const { data, error } = await db
      .from('drugs')
      .select('*')
      .ilike('name', `%${searchTerm}%`);

    if (error) {
      console.error('Error searching drugs:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in search_drugs:', error);
    return [];
  }
}

// ============================================================================
// USER MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Gets the current user's ID using browser fingerprinting
 * Reuses the existing analytics system's visitor ID
 */
export async function get_user_id(): Promise<string> {
  return await getVisitorId();
}

/**
 * Gets the user's current token balance
 */
export async function get_user_balance(userId?: string): Promise<number | null> {
  try {
    const userIdToUse = userId || await getVisitorId();

    const { data, error } = await db
      .from('marketplace_users')
      .select('token_balance')
      .eq('user_id', userIdToUse)
      .single();

    if (error) {
      // User doesn't exist yet
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Error getting user balance:', error);
      return null;
    }

    return data?.token_balance ?? null;
  } catch (error) {
    console.error('Error in get_user_balance:', error);
    return null;
  }
}

/**
 * Creates a new marketplace user with default token balance (100)
 */
export async function create_marketplace_user(userId?: string): Promise<MarketplaceUser | null> {
  try {
    const userIdToUse = userId || await getVisitorId();

    // Check if user already exists
    const { data: existingUser } = await db
      .from('marketplace_users')
      .select('*')
      .eq('user_id', userIdToUse)
      .single();

    if (existingUser) {
      return existingUser;
    }

    // Create new user
    const { data, error } = await db
      .from('marketplace_users')
      .insert({
        user_id: userIdToUse,
        token_balance: 100,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating marketplace user:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in create_marketplace_user:', error);
    return null;
  }
}

/**
 * Gets or creates a marketplace user
 * Ensures user exists and returns their data
 */
export async function ensure_marketplace_user(userId?: string): Promise<MarketplaceUser | null> {
  const userIdToUse = userId || await getVisitorId();

  const balance = await get_user_balance(userIdToUse);

  if (balance === null) {
    return await create_marketplace_user(userIdToUse);
  }

  const { data } = await db
    .from('marketplace_users')
    .select('*')
    .eq('user_id', userIdToUse)
    .single();

  return data;
}

// ============================================================================
// PURCHASE FUNCTIONS
// ============================================================================

/**
 * Purchases a drug (validates tokens and stock, updates balances)
 * Returns success status and details about the purchase
 */
export async function buy_drug(
  drugName: string,
  quantity: number,
  userId?: string
): Promise<{ success: boolean; message: string; new_balance?: number; purchase?: Purchase }> {
  try {
    const userIdToUse = userId || await getVisitorId();

    // Ensure user exists
    const user = await ensure_marketplace_user(userIdToUse);
    if (!user) {
      return { success: false, message: 'Failed to create or retrieve user' };
    }

    // Get drug information
    const { data: drug, error: drugError } = await db
      .from('drugs')
      .select('*')
      .ilike('name', drugName)
      .single();

    if (drugError || !drug) {
      return { success: false, message: 'Drug not found' };
    }

    // Validate quantity
    if (quantity <= 0) {
      return { success: false, message: 'Quantity must be greater than 0' };
    }

    // Check stock
    if (drug.stock < quantity) {
      return {
        success: false,
        message: `Insufficient stock. Only ${drug.stock} units available`
      };
    }

    // Calculate total cost
    const totalCost = drug.price * quantity;

    // Check user balance
    if (user.token_balance < totalCost) {
      return {
        success: false,
        message: `Insufficient tokens. Need ${totalCost}, have ${user.token_balance}`
      };
    }

    // Execute purchase
    // 1. Update user balance
    const newBalance = user.token_balance - totalCost;
    const { error: balanceError } = await db
      .from('marketplace_users')
      .update({ token_balance: newBalance })
      .eq('user_id', userIdToUse);

    if (balanceError) {
      console.error('Error updating user balance:', balanceError);
      return { success: false, message: 'Failed to update balance' };
    }

    // 2. Update drug stock
    const { error: stockError } = await db
      .from('drugs')
      .update({ stock: drug.stock - quantity })
      .eq('id', drug.id);

    if (stockError) {
      console.error('Error updating drug stock:', stockError);
      // Rollback balance update
      await db
        .from('marketplace_users')
        .update({ token_balance: user.token_balance })
        .eq('user_id', userIdToUse);
      return { success: false, message: 'Failed to update stock' };
    }

    // 3. Record purchase
    const { data: purchase, error: purchaseError } = await db
      .from('purchases')
      .insert({
        user_id: userIdToUse,
        drug_id: drug.id,
        quantity,
        total_cost: totalCost,
      })
      .select()
      .single();

    if (purchaseError) {
      console.error('Error recording purchase:', purchaseError);
      // Note: In production, you'd want to rollback all changes here
      return { success: false, message: 'Failed to record purchase' };
    }

    return {
      success: true,
      message: `Successfully purchased ${quantity} unit(s) of ${drug.name} for ${totalCost} tokens`,
      new_balance: newBalance,
      purchase
    };
  } catch (error) {
    console.error('Error in buy_drug:', error);
    return { success: false, message: 'Unknown error occurred' };
  }
}

/**
 * Gets the purchase history for a user
 */
export async function get_purchase_history(userId?: string): Promise<Purchase[]> {
  try {
    const userIdToUse = userId || await getVisitorId();

    const { data, error } = await db
      .from('purchases')
      .select('*')
      .eq('user_id', userIdToUse)
      .order('purchase_date', { ascending: false });

    if (error) {
      console.error('Error getting purchase history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in get_purchase_history:', error);
    return [];
  }
}

/**
 * Gets purchase history with drug details
 */
export async function get_purchase_history_with_drugs(userId?: string): Promise<PurchaseWithDrug[]> {
  try {
    const userIdToUse = userId || await getVisitorId();

    const { data, error } = await db
      .from('purchases')
      .select(`
        *,
        drugs:drug_id (
          name,
          description,
          price
        )
      `)
      .eq('user_id', userIdToUse)
      .order('purchase_date', { ascending: false });

    if (error) {
      console.error('Error getting purchase history with drugs:', error);
      return [];
    }

    return (data as PurchaseWithDrug[]) || [];
  } catch (error) {
    console.error('Error in get_purchase_history_with_drugs:', error);
    return [];
  }
}

// ============================================================================
// ADMIN FUNCTIONS
// ============================================================================

/**
 * Updates the price of a drug
 */
export async function update_drug_price(
  drugName: string,
  newPrice: number
): Promise<{ success: boolean; message: string }> {
  try {
    if (newPrice < 0) {
      return { success: false, message: 'Price cannot be negative' };
    }

    const { error } = await db
      .from('drugs')
      .update({ price: newPrice })
      .ilike('name', drugName);

    if (error) {
      console.error('Error updating drug price:', error);
      return { success: false, message: error.message };
    }

    return { success: true, message: `Price updated to ${newPrice} tokens` };
  } catch (error) {
    console.error('Error in update_drug_price:', error);
    return { success: false, message: 'Unknown error occurred' };
  }
}

/**
 * Restocks a drug (adds to existing stock)
 */
export async function restock_drug(
  drugName: string,
  additionalStock: number
): Promise<{ success: boolean; message: string }> {
  try {
    if (additionalStock <= 0) {
      return { success: false, message: 'Stock addition must be positive' };
    }

    // Get current stock
    const { data: drug, error: fetchError } = await db
      .from('drugs')
      .select('stock')
      .ilike('name', drugName)
      .single();

    if (fetchError || !drug) {
      return { success: false, message: 'Drug not found' };
    }

    // Update stock
    const { error: updateError } = await db
      .from('drugs')
      .update({ stock: drug.stock + additionalStock })
      .ilike('name', drugName);

    if (updateError) {
      console.error('Error restocking drug:', updateError);
      return { success: false, message: updateError.message };
    }

    return {
      success: true,
      message: `Stock increased by ${additionalStock}. New total: ${drug.stock + additionalStock}`
    };
  } catch (error) {
    console.error('Error in restock_drug:', error);
    return { success: false, message: 'Unknown error occurred' };
  }
}

/**
 * Gets marketplace statistics
 */
export async function get_marketplace_stats() {
  try {
    // Get total users
    const { count: userCount } = await db
      .from('marketplace_users')
      .select('*', { count: 'exact', head: true });

    // Get total purchases
    const { count: purchaseCount } = await db
      .from('purchases')
      .select('*', { count: 'exact', head: true });

    // Get total revenue (sum of all purchases)
    const { data: purchases } = await db
      .from('purchases')
      .select('total_cost');

    const totalRevenue = purchases?.reduce((sum: number, p: any) => sum + p.total_cost, 0) || 0;

    // Get total drugs
    const { count: drugCount } = await db
      .from('drugs')
      .select('*', { count: 'exact', head: true });

    // Get low stock drugs (stock < 50)
    const { data: lowStockDrugs } = await db
      .from('drugs')
      .select('name, stock')
      .lt('stock', 50)
      .order('stock');

    return {
      totalUsers: userCount || 0,
      totalPurchases: purchaseCount || 0,
      totalRevenue,
      totalDrugs: drugCount || 0,
      lowStockDrugs: lowStockDrugs || [],
    };
  } catch (error) {
    console.error('Error in get_marketplace_stats:', error);
    return {
      totalUsers: 0,
      totalPurchases: 0,
      totalRevenue: 0,
      totalDrugs: 0,
      lowStockDrugs: [],
    };
  }
}
