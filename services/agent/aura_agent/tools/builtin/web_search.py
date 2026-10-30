from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from aura_agent.services.browser import BrowserService
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult


class WebSearchArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=2,
        max_length=200,
        description="The search query or keywords to look up on the web.",
    )
    max_results: int = Field(
        default=5,
        ge=1,
        le=10,
        description="Maximum number of search results to return (1 to 10).",
    )


class WebSearchTool(BaseTool):
    """Tool to search the web using supported search pages without paid search APIs."""

    name = "web_search"
    description = "Search the internet for up-to-date information, documentation, or public knowledge without paid APIs."
    risk_tier = RiskTier.TIER_3_SYSTEM_EXTERNAL
    args_schema = WebSearchArgs

    def __init__(self, browser_service: BrowserService):
        self.browser_service = browser_service

    async def execute(self, args: WebSearchArgs, context: ExecutionContext) -> ToolResult:
        try:
            # Policy check: Tier 3 requires confirmation unless confirmed
            if not context.user_confirmed and context.policy in ("request-review", "strict"):
                return ToolResult(
                    success=False,
                    summary=f"Searching the web for '{args.query}' requires user confirmation.",
                    error=f"Confirmation required to perform external web search for '{args.query}'.",
                    recovery_options=["Approve the search request", "Refine search query"],
                    risk_tier=self.risk_tier,
                )

            results = await self.browser_service.search(args.query, max_results=args.max_results)

            if not results:
                summary = f"No search results found for query '{args.query}'."
                return ToolResult(
                    success=True,
                    data={"query": args.query, "results": [], "count": 0},
                    summary=summary,
                    risk_tier=self.risk_tier,
                )

            results_data = [r.to_dict() for r in results]
            summary = f"Found {len(results)} search results for '{args.query}'."

            return ToolResult(
                success=True,
                data={
                    "query": args.query,
                    "results": results_data,
                    "count": len(results_data),
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Web search failed: {exc}",
                error=str(exc),
                recovery_options=["Verify network connectivity", "Try a different search query"],
                risk_tier=self.risk_tier,
            )
