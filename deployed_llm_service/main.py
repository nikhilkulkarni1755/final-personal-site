from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
from agent import process_user_query
from config import get_settings
import uvicorn


# ============================================================================
# FASTAPI APP
# ============================================================================

app = FastAPI(
    title="Drug Marketplace Voice Agent API",
    description="LLM-powered voice agent for drug marketplace operations",
    version="1.0.0"
)

# CORS middleware - adjust origins for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class QueryRequest(BaseModel):
    """Request model for processing user queries"""
    user_id: str = Field(..., description="Unique user identifier", min_length=1)
    query: str = Field(..., description="User's natural language query", min_length=1)

    class Config:
        json_schema_extra = {
            "example": {
                "user_id": "user-123",
                "query": "I want to buy 2 units of MindEase"
            }
        }


class QueryResponse(BaseModel):
    """Response model for query results"""
    success: bool = Field(..., description="Whether the query was processed successfully")
    response: str = Field(..., description="Agent's response to the user")
    error: Optional[str] = Field(None, description="Error message if applicable")

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "response": "Purchase successful! You bought 2 units of MindEase for 50 tokens. Your new balance is 50 tokens.",
                "error": None
            }
        }


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    message: str


# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/", response_model=HealthResponse)
async def root():
    """Root endpoint - health check"""
    return {
        "status": "healthy",
        "message": "Drug Marketplace Voice Agent API is running"
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for monitoring"""
    return {
        "status": "healthy",
        "message": "All systems operational"
    }


@app.post("/process", response_model=QueryResponse)
async def process_query(request: QueryRequest):
    """
    Process a user query using the LLM agent.

    This endpoint:
    1. Receives user_id and natural language query
    2. Uses ChatGPT with LangChain to understand the intent
    3. Calls appropriate Supabase API tools
    4. Returns the agent's response

    Example queries:
    - "What's my balance?"
    - "Show me all available drugs"
    - "I want to buy 2 units of MindEase"
    - "How much does PainAway cost?"
    """
    try:
        # Validate inputs
        if not request.user_id.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="user_id cannot be empty"
            )

        if not request.query.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="query cannot be empty"
            )

        # Process the query
        result = process_user_query(request.user_id, request.query)

        # Return result
        return QueryResponse(**result)

    except HTTPException:
        raise
    except Exception as e:
        # Log the error (in production, use proper logging)
        print(f"Error in /process endpoint: {e}")

        # Return error response
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(e)}"
        )


@app.post("/query", response_model=QueryResponse)
async def process_query_alias(request: QueryRequest):
    """
    Alias for /process endpoint.
    Same functionality, different endpoint name.
    """
    return await process_query(request)


# ============================================================================
# STARTUP/SHUTDOWN EVENTS
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Run on application startup"""
    settings = get_settings()
    print(f"🚀 Starting Drug Marketplace Voice Agent API")
    print(f"📡 Supabase URL: {settings.supabase_url}")
    print(f"🤖 Using OpenAI GPT models")
    print(f"✅ Server ready on {settings.host}:{settings.port}")


@app.on_event("shutdown")
async def shutdown_event():
    """Run on application shutdown"""
    print("👋 Shutting down Drug Marketplace Voice Agent API")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    settings = get_settings()

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,  # Set to False in production
        log_level="info"
    )
