from langchain.tools import Tool
from langchain.pydantic_v1 import BaseModel, Field
from typing import Optional, List
from supabase_client import MarketplaceAPI
import json


# Global marketplace API instance
marketplace = MarketplaceAPI()


# ============================================================================
# TOOL INPUT SCHEMAS
# ============================================================================

class CheckBalanceInput(BaseModel):
    """Input for check_balance tool"""
    user_id: str = Field(description="The user ID to check balance for")


class GetDrugPriceInput(BaseModel):
    """Input for get_drug_price tool"""
    drug_name: str = Field(description="The name of the drug to get the price for")


class GetDrugStockInput(BaseModel):
    """Input for get_drug_stock tool"""
    drug_name: str = Field(description="The name of the drug to check stock for")


class PurchaseDrugInput(BaseModel):
    """Input for purchase_drug tool"""
    user_id: str = Field(description="The user ID making the purchase")
    drug_name: str = Field(description="The name of the drug to purchase")
    quantity: int = Field(description="The number of units to purchase", gt=0)


class ListDrugsInput(BaseModel):
    """Input for list_drugs tool - no parameters needed"""
    pass


class GetPurchaseHistoryInput(BaseModel):
    """Input for get_purchase_history tool"""
    user_id: str = Field(description="The user ID to get purchase history for")


# ============================================================================
# TOOL FUNCTIONS
# ============================================================================

def check_balance(user_id: str) -> str:
    """
    Check the current token balance for a user.
    Returns the balance or an error message.
    """
    marketplace.ensure_user_exists(user_id)
    balance = marketplace.get_user_balance(user_id)

    if balance is not None:
        return f"Current balance: {balance} tokens"
    else:
        return "Error: Could not retrieve user balance"


def get_drug_price(drug_name: str) -> str:
    """
    Get the price of a specific drug.
    Returns the price or an error message.
    """
    price = marketplace.get_drug_price(drug_name)

    if price is not None:
        return f"{drug_name} costs {price} tokens per unit"
    else:
        return f"Error: Drug '{drug_name}' not found"


def get_drug_stock(drug_name: str) -> str:
    """
    Check the available stock for a specific drug.
    Returns the stock level or an error message.
    """
    stock = marketplace.get_drug_stock(drug_name)

    if stock is not None:
        return f"{drug_name} has {stock} units in stock"
    else:
        return f"Error: Drug '{drug_name}' not found"


def purchase_drug(user_id: str, drug_name: str, quantity: int) -> str:
    """
    Purchase a drug. This will:
    1. Check user balance
    2. Check drug price and stock
    3. Execute purchase if possible
    4. Return success or failure message
    """
    result = marketplace.purchase_drug(user_id, drug_name, quantity)

    if result['success']:
        return f"{result['message']}. New balance: {result.get('new_balance', 'N/A')} tokens"
    else:
        return f"Purchase failed: {result['message']}"


def list_drugs() -> str:
    """
    List all available drugs with their prices and stock levels.
    """
    drugs = marketplace.get_all_drugs()

    if not drugs:
        return "No drugs available in the marketplace"

    drug_list = []
    for drug in drugs:
        drug_list.append(
            f"- {drug['name']}: {drug['price']} tokens/unit, "
            f"{drug['stock']} in stock - {drug.get('description', 'No description')}"
        )

    return "Available drugs:\n" + "\n".join(drug_list)


def get_purchase_history(user_id: str) -> str:
    """
    Get the purchase history for a user.
    """
    history = marketplace.get_purchase_history(user_id)

    if not history:
        return "No purchase history found for this user"

    purchases = []
    for purchase in history[:10]:  # Limit to 10 most recent
        drug_info = purchase.get('drugs', {})
        drug_name = drug_info.get('name', 'Unknown') if drug_info else 'Unknown'
        purchases.append(
            f"- {purchase['quantity']} units of {drug_name} "
            f"for {purchase['total_cost']} tokens "
            f"on {purchase['purchase_date']}"
        )

    return "Recent purchases:\n" + "\n".join(purchases)


# ============================================================================
# LANGCHAIN TOOLS
# ============================================================================

def create_marketplace_tools() -> List[Tool]:
    """
    Create LangChain tools for the marketplace agent.
    These tools will be available to the ChatGPT agent.
    """

    tools = [
        Tool(
            name="check_balance",
            func=check_balance,
            description=(
                "Check the current token balance for a user. "
                "Use this when the user asks about their balance, tokens, or money. "
                "Input: user_id (string)"
            ),
            args_schema=CheckBalanceInput
        ),
        Tool(
            name="get_drug_price",
            func=get_drug_price,
            description=(
                "Get the price of a specific drug. "
                "Use this when the user asks how much a drug costs. "
                "Input: drug_name (string)"
            ),
            args_schema=GetDrugPriceInput
        ),
        Tool(
            name="get_drug_stock",
            func=get_drug_stock,
            description=(
                "Check the available stock for a specific drug. "
                "Use this when the user asks if a drug is available or how many units are in stock. "
                "Input: drug_name (string)"
            ),
            args_schema=GetDrugStockInput
        ),
        Tool(
            name="list_drugs",
            func=list_drugs,
            description=(
                "List all available drugs with their prices and stock levels. "
                "Use this when the user asks what drugs are available, wants to see options, "
                "or asks for a list of products."
            ),
            args_schema=ListDrugsInput
        ),
        Tool(
            name="purchase_drug",
            func=purchase_drug,
            description=(
                "Purchase a drug for a user. This automatically checks balance, price, and stock, "
                "then executes the purchase if possible. "
                "Use this when the user wants to buy a drug. "
                "IMPORTANT: You should check balance, price, and stock BEFORE calling this to inform the user. "
                "Input: user_id (string), drug_name (string), quantity (integer)"
            ),
            args_schema=PurchaseDrugInput
        ),
        Tool(
            name="get_purchase_history",
            func=get_purchase_history,
            description=(
                "Get the purchase history for a user. "
                "Use this when the user asks about their past purchases or order history. "
                "Input: user_id (string)"
            ),
            args_schema=GetPurchaseHistoryInput
        ),
    ]

    return tools
