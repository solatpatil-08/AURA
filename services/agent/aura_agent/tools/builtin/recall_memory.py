from typing import Optional
from pydantic import BaseModel, Field
from aura_agent.services.memory import MemoryService
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult


class RecallMemoryArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Search topic, concept, or keyword to retrieve from memory.",
    )
    category: Optional[str] = Field(
        default=None,
        description="Optional category to filter by ('preference', 'fact', 'project', 'instruction', or 'general').",
    )
    limit: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Maximum number of relevant memories to retrieve (1 to 10).",
    )


class RecallMemoryTool(BaseTool):
    """Tool to search and recall relevant stored facts or preferences from local memory."""

    name = "recall_memory"
    description = "Recall and retrieve stored user facts, preferences, project guidelines, or past instructions from persistent local memory."
    risk_tier = RiskTier.TIER_1_READ_ONLY
    args_schema = RecallMemoryArgs

    def __init__(self, memory_service: MemoryService):
        self.memory_service = memory_service

    async def execute(self, args: RecallMemoryArgs, context: ExecutionContext) -> ToolResult:
        try:
            hits = await self.memory_service.search_relevant_memories(
                query=args.query,
                limit=args.limit,
                category=args.category,
            )

            if not hits:
                return ToolResult(
                    success=True,
                    data={"query": args.query, "results": [], "count": 0},
                    summary=f"No relevant memories found for query: '{args.query}'.",
                    risk_tier=self.risk_tier,
                )

            formatted_results = [
                {
                    "id": mem.id,
                    "category": mem.category,
                    "key": mem.key,
                    "content": mem.content,
                    "is_pinned": mem.is_pinned,
                    "relevance_score": score,
                }
                for mem, score in hits
            ]

            summary = f"Recalled {len(formatted_results)} relevant memories for '{args.query}'."
            return ToolResult(
                success=True,
                data={
                    "query": args.query,
                    "results": formatted_results,
                    "count": len(formatted_results),
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Memory recall failed: {exc}",
                error=str(exc),
                recovery_options=["Try a broader search term"],
                risk_tier=self.risk_tier,
            )
