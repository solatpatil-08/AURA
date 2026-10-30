from typing import Optional
from pydantic import BaseModel, Field
from aura_agent.services.memory import MemoryService, MemorySecurityError
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult


class SaveMemoryArgs(BaseModel):
    content: str = Field(
        ...,
        min_length=2,
        max_length=4000,
        description="The useful user preference, factual detail, project information, or instruction to remember.",
    )
    category: str = Field(
        default="general",
        max_length=50,
        description="Memory category: 'preference', 'fact', 'project', 'instruction', or 'general'.",
    )
    key: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Optional short identifier or topic key (e.g., 'coding_style', 'user_name', 'project_path').",
    )
    is_pinned: bool = Field(
        default=False,
        description="Whether this memory should be pinned to prevent automatic retention expiration.",
    )


class SaveMemoryTool(BaseTool):
    """Tool to save a useful preference, fact, or instruction into persistent local memory."""

    name = "save_memory"
    description = "Save useful user preferences, project details, or factual knowledge into local persistent memory for future sessions."
    risk_tier = RiskTier.TIER_2_MONITORED_WRITE
    args_schema = SaveMemoryArgs

    def __init__(self, memory_service: MemoryService):
        self.memory_service = memory_service

    async def execute(self, args: SaveMemoryArgs, context: ExecutionContext) -> ToolResult:
        try:
            # Policy check: Tier 2 requires confirmation under strict policy
            if not context.user_confirmed and context.policy == "strict":
                return ToolResult(
                    success=False,
                    summary=f"Saving memory [{args.category}:{args.key or 'note'}] requires user confirmation under strict policy.",
                    error=f"Confirmation required to store persistent memory: '{args.content[:80]}...'",
                    recovery_options=["Approve saving this memory", "Cancel memory storage"],
                    risk_tier=self.risk_tier,
                )

            # Validate secret prohibition
            self.memory_service.validate_content_safety(args.content, args.key)

            memory = await self.memory_service.create_memory(
                category=args.category,
                content=args.content,
                key=args.key,
                source_session_id=context.session_id,
                is_pinned=args.is_pinned,
            )

            summary = f"Remembered [{memory.category}:{memory.key or 'general'}]: '{memory.content[:60]}...'"
            return ToolResult(
                success=True,
                data={
                    "id": memory.id,
                    "category": memory.category,
                    "key": memory.key,
                    "content": memory.content,
                    "is_pinned": memory.is_pinned,
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except MemorySecurityError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security rejection: Cannot store credentials in memory.",
                error=str(sec_err),
                recovery_options=["Do not store passwords, API keys, or private tokens in memory"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to save memory: {exc}",
                error=str(exc),
                recovery_options=["Check memory database connection"],
                risk_tier=self.risk_tier,
            )
