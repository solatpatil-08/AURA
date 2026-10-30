from typing import Optional
from pydantic import BaseModel, Field
from aura_agent.services.memory import MemoryService
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult


class ForgetMemoryArgs(BaseModel):
    memory_id: Optional[str] = Field(
        default=None,
        description="The unique ID of the memory item to delete.",
    )
    query: Optional[str] = Field(
        default=None,
        description="Key or keyword phrase of the memory to forget.",
    )


class ForgetMemoryTool(BaseTool):
    """Tool to delete or remove an obsolete memory from local storage."""

    name = "forget_memory"
    description = "Delete or clear an obsolete memory or preference from persistent local storage."
    risk_tier = RiskTier.TIER_2_MONITORED_WRITE
    args_schema = ForgetMemoryArgs

    def __init__(self, memory_service: MemoryService):
        self.memory_service = memory_service

    async def execute(self, args: ForgetMemoryArgs, context: ExecutionContext) -> ToolResult:
        try:
            target_id = args.memory_id

            if not target_id and args.query:
                # Find matching memory
                matches = await self.memory_service.search_relevant_memories(args.query, limit=1)
                if matches:
                    target_id = matches[0][0].id

            if not target_id:
                return ToolResult(
                    success=False,
                    summary="No memory item found to forget. Provide either memory_id or a matching query.",
                    error="Memory not found",
                    recovery_options=["Use recall_memory first to inspect stored memories"],
                    risk_tier=self.risk_tier,
                )

            # Check policy confirmation under strict
            if not context.user_confirmed and context.policy == "strict":
                return ToolResult(
                    success=False,
                    summary=f"Deleting memory '{target_id}' requires user confirmation under strict policy.",
                    error=f"Confirmation required to delete memory ID {target_id}.",
                    recovery_options=["Approve deletion of this memory", "Keep memory"],
                    risk_tier=self.risk_tier,
                )

            deleted = await self.memory_service.delete_memory(target_id)
            if not deleted:
                return ToolResult(
                    success=False,
                    summary=f"Memory ID '{target_id}' does not exist or was already deleted.",
                    error="Memory not found",
                    risk_tier=self.risk_tier,
                )

            return ToolResult(
                success=True,
                data={"deleted_id": target_id},
                summary=f"Successfully forgot memory item '{target_id}'.",
                risk_tier=self.risk_tier,
            )

        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to delete memory: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
