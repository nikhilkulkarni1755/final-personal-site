from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from tools import create_marketplace_tools
from config import get_settings
from typing import Dict, Any


# ============================================================================
# AGENT PROMPT
# ============================================================================

SYSTEM_PROMPT = """You are a helpful marketplace assistant for a drug marketplace.

Your job is to help users:
1. Check their token balance
2. Browse available drugs
3. Get information about drug prices and stock
4. Purchase drugs

IMPORTANT GUIDELINES:
- When a user wants to BUY something, you MUST:
  1. First check their current balance
  2. Check the drug price
  3. Check if the drug is in stock
  4. Calculate if they have enough tokens
  5. Inform them of the total cost
  6. Only then execute the purchase

- Be conversational and helpful
- If a purchase fails, explain why clearly
- Always confirm successful purchases with the new balance
- If asked about drugs, list all available options

Example conversation:
User: "I want to buy 2 units of MindEase"
Assistant:
  [checks balance: 100 tokens]
  [checks drug price: MindEase costs 25 tokens per unit]
  [checks stock: 50 units available]
  [calculates: 2 × 25 = 50 tokens needed, user has 100]
  "Great! MindEase costs 25 tokens per unit. For 2 units, that's 50 tokens total. You currently have 100 tokens, so you have enough! Let me process this purchase for you."
  [executes purchase]
  "Purchase successful! You bought 2 units of MindEase for 50 tokens. Your new balance is 50 tokens."

Current user_id: {user_id}
"""


# ============================================================================
# AGENT CREATION
# ============================================================================

def create_marketplace_agent(user_id: str) -> AgentExecutor:
    """
    Create a LangChain agent with ChatGPT and marketplace tools.

    Args:
        user_id: The user ID for this session

    Returns:
        AgentExecutor that can process user queries
    """
    settings = get_settings()

    # Initialize ChatGPT
    llm = ChatOpenAI(
        model="gpt-4o-mini",  # Use gpt-4o-mini for cost efficiency, or gpt-4o for better reasoning
        temperature=0.7,
        api_key=settings.openai_api_key
    )

    # Get marketplace tools
    tools = create_marketplace_tools()

    # Create prompt with user_id context
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT.format(user_id=user_id)),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("user", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    # Create the agent
    agent = create_openai_tools_agent(llm, tools, prompt)

    # Create executor
    agent_executor = AgentExecutor(
        agent=agent,
        tools=tools,
        verbose=True,  # Set to False in production
        handle_parsing_errors=True,
        max_iterations=10,  # Prevent infinite loops
    )

    return agent_executor


# ============================================================================
# AGENT INVOCATION
# ============================================================================

def process_user_query(user_id: str, query: str) -> Dict[str, Any]:
    """
    Process a user query using the marketplace agent.

    Args:
        user_id: The user ID making the query
        query: The user's natural language query

    Returns:
        {
            'success': bool,
            'response': str,
            'error': Optional[str]
        }
    """
    try:
        # Create agent for this user
        agent = create_marketplace_agent(user_id)

        # Run the agent
        result = agent.invoke({
            "input": query,
            "chat_history": []  # Could extend this to maintain conversation history
        })

        return {
            'success': True,
            'response': result.get('output', 'No response generated'),
            'error': None
        }

    except Exception as e:
        print(f"Error processing query: {e}")
        return {
            'success': False,
            'response': 'Sorry, I encountered an error processing your request.',
            'error': str(e)
        }


# ============================================================================
# EXAMPLE USAGE
# ============================================================================

if __name__ == "__main__":
    # Example test queries
    test_queries = [
        "What's my balance?",
        "Show me all available drugs",
        "How much does MindEase cost?",
        "I want to buy 2 units of MindEase",
        "Show me my purchase history"
    ]

    user_id = "test-user-123"

    for query in test_queries:
        print(f"\n{'='*60}")
        print(f"USER: {query}")
        print(f"{'='*60}")

        result = process_user_query(user_id, query)

        if result['success']:
            print(f"ASSISTANT: {result['response']}")
        else:
            print(f"ERROR: {result['error']}")
