from supabase import create_client, Client
from config import get_settings
from typing import Optional, Dict, Any, List
from functools import lru_cache


@lru_cache()
def get_supabase_client() -> Client:
    """Get cached Supabase client instance"""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)


class MarketplaceAPI:
    """API client for marketplace operations"""

    def __init__(self):
        self.client = get_supabase_client()

    # ========================================================================
    # USER OPERATIONS
    # ========================================================================

    def get_user_balance(self, user_id: str) -> Optional[int]:
        """Get user's current token balance"""
        try:
            response = self.client.table('marketplace_users') \
                .select('token_balance') \
                .eq('user_id', user_id) \
                .single() \
                .execute()

            if response.data:
                return response.data['token_balance']
            return None
        except Exception as e:
            print(f"Error getting user balance: {e}")
            return None

    def ensure_user_exists(self, user_id: str) -> bool:
        """Ensure user exists in database, create if not"""
        try:
            # Check if user exists
            existing = self.client.table('marketplace_users') \
                .select('user_id') \
                .eq('user_id', user_id) \
                .execute()

            if existing.data:
                return True

            # Create new user with 100 tokens
            self.client.table('marketplace_users') \
                .insert({'user_id': user_id, 'token_balance': 100}) \
                .execute()
            return True
        except Exception as e:
            print(f"Error ensuring user exists: {e}")
            return False

    # ========================================================================
    # DRUG INFORMATION
    # ========================================================================

    def get_drug_info(self, drug_name: str) -> Optional[Dict[str, Any]]:
        """Get complete drug information by name"""
        try:
            response = self.client.table('drugs') \
                .select('*') \
                .ilike('name', drug_name) \
                .single() \
                .execute()

            return response.data if response.data else None
        except Exception as e:
            print(f"Error getting drug info: {e}")
            return None

    def get_all_drugs(self) -> List[Dict[str, Any]]:
        """Get all available drugs"""
        try:
            response = self.client.table('drugs') \
                .select('id, name, description, price, stock') \
                .order('name') \
                .execute()

            return response.data if response.data else []
        except Exception as e:
            print(f"Error getting all drugs: {e}")
            return []

    def get_drug_price(self, drug_name: str) -> Optional[int]:
        """Get drug price"""
        drug = self.get_drug_info(drug_name)
        return drug['price'] if drug else None

    def get_drug_stock(self, drug_name: str) -> Optional[int]:
        """Get drug stock"""
        drug = self.get_drug_info(drug_name)
        return drug['stock'] if drug else None

    # ========================================================================
    # PURCHASE OPERATIONS
    # ========================================================================

    def purchase_drug(
        self,
        user_id: str,
        drug_name: str,
        quantity: int
    ) -> Dict[str, Any]:
        """
        Purchase a drug with full validation and atomic transaction

        Returns:
            {
                'success': bool,
                'message': str,
                'new_balance': Optional[int],
                'total_cost': Optional[int]
            }
        """
        try:
            # Ensure user exists
            if not self.ensure_user_exists(user_id):
                return {
                    'success': False,
                    'message': 'Failed to initialize user account'
                }

            # Get user balance
            balance = self.get_user_balance(user_id)
            if balance is None:
                return {
                    'success': False,
                    'message': 'Could not retrieve user balance'
                }

            # Get drug info
            drug = self.get_drug_info(drug_name)
            if not drug:
                return {
                    'success': False,
                    'message': f'Drug "{drug_name}" not found in marketplace'
                }

            # Validate quantity
            if quantity <= 0:
                return {
                    'success': False,
                    'message': 'Quantity must be greater than 0'
                }

            # Check stock
            if drug['stock'] < quantity:
                return {
                    'success': False,
                    'message': f"Insufficient stock. Only {drug['stock']} units available"
                }

            # Calculate cost
            total_cost = drug['price'] * quantity

            # Check balance
            if balance < total_cost:
                return {
                    'success': False,
                    'message': f"Insufficient tokens. Need {total_cost}, have {balance}"
                }

            # Execute purchase using RPC function (atomic transaction)
            # Note: This assumes you have the purchase_drug() PostgreSQL function
            # If not, we'll use manual transaction (less safe for concurrency)
            try:
                result = self.client.rpc(
                    'purchase_drug',
                    {
                        'p_user_id': user_id,
                        'p_drug_name': drug_name,
                        'p_quantity': quantity
                    }
                ).execute()

                if result.data and result.data.get('success'):
                    return result.data
                else:
                    return result.data or {
                        'success': False,
                        'message': 'Purchase failed'
                    }
            except Exception as rpc_error:
                # Fallback to manual transaction if RPC doesn't exist
                print(f"RPC purchase_drug not found, using manual transaction: {rpc_error}")
                return self._manual_purchase(user_id, drug, quantity, balance, total_cost)

        except Exception as e:
            print(f"Error in purchase_drug: {e}")
            return {
                'success': False,
                'message': f'Purchase failed: {str(e)}'
            }

    def _manual_purchase(
        self,
        user_id: str,
        drug: Dict[str, Any],
        quantity: int,
        current_balance: int,
        total_cost: int
    ) -> Dict[str, Any]:
        """
        Manual purchase transaction (fallback if RPC doesn't exist)
        WARNING: Less safe for concurrent requests
        """
        try:
            new_balance = current_balance - total_cost

            # Update user balance
            self.client.table('marketplace_users') \
                .update({'token_balance': new_balance}) \
                .eq('user_id', user_id) \
                .execute()

            # Update drug stock
            self.client.table('drugs') \
                .update({'stock': drug['stock'] - quantity}) \
                .eq('id', drug['id']) \
                .execute()

            # Record purchase
            self.client.table('purchases') \
                .insert({
                    'user_id': user_id,
                    'drug_id': drug['id'],
                    'quantity': quantity,
                    'total_cost': total_cost
                }) \
                .execute()

            return {
                'success': True,
                'message': f"Successfully purchased {quantity} unit(s) of {drug['name']} for {total_cost} tokens",
                'new_balance': new_balance,
                'total_cost': total_cost
            }
        except Exception as e:
            print(f"Manual purchase error: {e}")
            return {
                'success': False,
                'message': f'Transaction failed: {str(e)}'
            }

    # ========================================================================
    # PURCHASE HISTORY
    # ========================================================================

    def get_purchase_history(self, user_id: str) -> List[Dict[str, Any]]:
        """Get user's purchase history"""
        try:
            response = self.client.table('purchases') \
                .select('*, drugs:drug_id(name, price)') \
                .eq('user_id', user_id) \
                .order('purchase_date', desc=True) \
                .execute()

            return response.data if response.data else []
        except Exception as e:
            print(f"Error getting purchase history: {e}")
            return []
