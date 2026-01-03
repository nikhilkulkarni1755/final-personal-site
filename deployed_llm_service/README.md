# Drug Marketplace Voice Agent API

A FastAPI-based LLM service that uses ChatGPT and LangChain to process natural language queries for a drug marketplace. Handles token balance checks, drug purchases, and inventory management through conversational AI.

## Features

- **LLM-Powered**: Uses ChatGPT (gpt-4o-mini) with LangChain for intelligent query understanding
- **Tool Calling**: Automatic tool selection based on user intent
- **Supabase Integration**: Direct API calls to marketplace database
- **Concurrent Safe**: Supports atomic transactions for purchases
- **RESTful API**: Easy integration with any frontend

## Architecture

```
User Query → FastAPI Endpoint → LangChain Agent → ChatGPT
                                      ↓
                            Tool Selection & Execution
                                      ↓
                              Supabase API Calls
                                      ↓
                              Response to User
```

## Available Tools

The agent has access to these tools:

1. **check_balance** - Get user's current token balance
2. **get_drug_price** - Get price of a specific drug
3. **get_drug_stock** - Check available stock for a drug
4. **list_drugs** - List all available drugs with prices and stock
5. **purchase_drug** - Execute a drug purchase (with validation)
6. **get_purchase_history** - View user's past purchases

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:
- `OPENAI_API_KEY` - Your OpenAI API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key

### 3. Run Locally

```bash
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## API Endpoints

### POST /process

Process a user query with the LLM agent.

**Request:**
```json
{
  "user_id": "user-123",
  "query": "I want to buy 2 units of MindEase"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Great! MindEase costs 25 tokens per unit. For 2 units, that's 50 tokens total. You currently have 100 tokens. Purchase successful! Your new balance is 50 tokens.",
  "error": null
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "message": "All systems operational"
}
```

## Example Queries

The agent understands natural language queries like:

- "What's my balance?"
- "Show me all available drugs"
- "How much does MindEase cost?"
- "Is PainAway in stock?"
- "I want to buy 2 units of MindEase"
- "Buy 3 PainAway"
- "Show me my purchase history"

## Deployment to Render

### Option 1: Using render.yaml (Recommended)

1. Push this code to a GitHub repository

2. Go to [Render Dashboard](https://dashboard.render.com/)

3. Click "New +" → "Blueprint"

4. Connect your GitHub repository

5. Render will automatically detect `render.yaml` and configure the service

6. Set environment variables in Render dashboard:
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

7. Deploy!

### Option 2: Manual Setup

1. Go to [Render Dashboard](https://dashboard.render.com/)

2. Click "New +" → "Web Service"

3. Connect your GitHub repository

4. Configure:
   - **Name**: drug-marketplace-voice-agent
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free (or paid tier)

5. Add environment variables:
   - `OPENAI_API_KEY` - Your OpenAI API key
   - `SUPABASE_URL` - Your Supabase URL
   - `SUPABASE_ANON_KEY` - Your Supabase anon key
   - `PYTHON_VERSION` - 3.11.0

6. Click "Create Web Service"

### After Deployment

Your API will be available at:
```
https://drug-marketplace-voice-agent.onrender.com
```

Test it:
```bash
curl -X POST https://drug-marketplace-voice-agent.onrender.com/process \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user",
    "query": "What drugs are available?"
  }'
```

## Testing

Test the agent locally:

```bash
python agent.py
```

This will run example queries and show the agent's reasoning process.

## Integration with Voice Agent

To integrate with your existing Deepgram voice agent:

1. **Frontend**: Send transcription to this API instead of Supabase Edge Function

2. **Update voice-agent component**:
```typescript
// Instead of calling Supabase edge function
const response = await fetch('https://your-api.onrender.com/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: userId,
    query: transcript
  })
});

const result = await response.json();
console.log(result.response); // LLM's response
```

## Project Structure

```
deployed_llm_service/
├── main.py              # FastAPI application
├── agent.py             # LangChain agent configuration
├── tools.py             # LangChain tools (marketplace operations)
├── supabase_client.py   # Supabase API client
├── config.py            # Settings and configuration
├── requirements.txt     # Python dependencies
├── render.yaml          # Render deployment config
├── Procfile            # Process file for deployment
├── runtime.txt         # Python version
├── .env.example        # Example environment variables
├── .gitignore          # Git ignore rules
└── README.md           # This file
```

## Cost Considerations

- **Render Free Tier**: 750 hours/month (enough for one service running 24/7)
- **OpenAI gpt-4o-mini**: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- **Supabase**: Free tier includes 500MB database, 50,000 monthly active users

## Monitoring

Check logs in Render dashboard:
- Navigate to your service
- Click "Logs" tab
- See real-time agent reasoning and tool calls

## Troubleshooting

### "OPENAI_API_KEY not configured"
- Make sure you set the environment variable in Render dashboard
- Redeploy the service after adding variables

### "Could not connect to Supabase"
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct
- Check that your Supabase project is active

### Agent not calling tools correctly
- Check the verbose output in logs
- Ensure all Supabase tables exist (drugs, marketplace_users, purchases)
- Try with gpt-4o instead of gpt-4o-mini for better reasoning

## License

MIT
