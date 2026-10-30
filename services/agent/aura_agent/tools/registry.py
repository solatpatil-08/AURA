import asyncio
import logging
import time
import uuid
from typing import Any, Dict, List, Optional
from pydantic import ValidationError

from aura_agent.models.schemas import (
    ToolAuditLogSchema,
    ToolConfirmationProposal,
    ToolDefinitionSchema,
    ToolExecutionResponse,
)
from aura_agent.tools.audit import AuditLogger
from aura_agent.tools.base import (
    BaseTool,
    Decision,
    ExecutionContext,
    ExecutionStatus,
    RiskTier,
    ToolResult,
)

logger = logging.getLogger("aura.tools.registry")


class PendingAction:
    """Cached representation of an action waiting for human confirmation."""

    def __init__(
        self,
        call_id: str,
        tool_name: str,
        parameters: Dict[str, Any],
        context: ExecutionContext,
        risk_tier: RiskTier,
        reason: str,
        diff_preview: Optional[str] = None,
    ):
        self.call_id = call_id
        self.tool_name = tool_name
        self.parameters = parameters
        self.context = context
        self.risk_tier = risk_tier
        self.reason = reason
        self.diff_preview = diff_preview
        self.created_at = time.time()


class ToolRegistry:
    """Central registry and policy gatekeeper for typed AURA tools."""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._pending_confirmations: Dict[str, PendingAction] = {}

    def register(self, tool: BaseTool) -> None:
        """Register a new typed tool instance."""
        self._tools[tool.name] = tool
        logger.info("Registered tool: %s (%s)", tool.name, tool.risk_tier.value)

    def get(self, name: str) -> Optional[BaseTool]:
        """Look up tool by name."""
        return self._tools.get(name)

    def get_catalog(self) -> List[ToolDefinitionSchema]:
        """Return schema catalog for all registered tools."""
        catalog = []
        for tool in self._tools.values():
            catalog.append(
                ToolDefinitionSchema(
                    name=tool.name,
                    description=tool.description,
                    risk_tier=tool.risk_tier.value,
                    parameters=tool.args_schema.model_json_schema(),
                )
            )
        return catalog

    def get_ollama_tools(self) -> List[Dict[str, Any]]:
        """Return list of tool specifications in Ollama function format."""
        return [tool.to_ollama_tool() for tool in self._tools.values()]

    def is_confirmation_required(
        self,
        tool: BaseTool,
        parameters: Dict[str, Any],
        context: ExecutionContext,
    ) -> Optional[str]:
        """Determine whether an action requires explicit human confirmation."""
        # Tier 4 is never executed
        if tool.risk_tier == RiskTier.TIER_4_PROHIBITED:
            return "Prohibited system operation."

        # If user has already explicitly confirmed this action
        if context.user_confirmed:
            return None

        # Tier 3 (System & External) requires confirmation under 'request-review' and 'strict'
        if tool.risk_tier == RiskTier.TIER_3_SYSTEM_EXTERNAL:
            if context.policy in ("request-review", "strict"):
                if tool.name == "open_allowlisted_app":
                    app = parameters.get("app_name", "application")
                    return f"Launch external desktop application '{app}'."
                elif tool.name == "open_approved_url":
                    url = parameters.get("url", "website")
                    return f"Open external web URL '{url}' in system browser."
                return f"Execute external system action '{tool.name}'."

        # Tier 2 (Monitored Write) requires confirmation if policy is 'strict'
        # or under 'request-review' for potentially destructive operations
        if tool.risk_tier == RiskTier.TIER_2_MONITORED_WRITE:
            if context.policy == "strict":
                return f"Perform write operation '{tool.name}'."
            if context.policy == "request-review":
                # For overwrite check or significant changes
                if tool.name == "create_note":
                    title = parameters.get("title", "note")
                    return f"Create or overwrite note '{title}'."
                if tool.name == "create_folder":
                    path = parameters.get("relative_path", "folder")
                    return f"Create directory '{path}' in workspace."

        return None

    async def execute_tool(
        self,
        name: str,
        parameters: Dict[str, Any],
        context: ExecutionContext,
        audit_logger: Optional[AuditLogger] = None,
    ) -> ToolExecutionResponse:
        """Validate, authorize, and execute a tool call with audit logging and timeout safety."""
        tool = self.get(name)
        start_time = time.time()

        if not tool:
            err_msg = f"Tool '{name}' is not registered in AURA's tool registry."
            duration = (time.time() - start_time) * 1000.0
            if audit_logger:
                await audit_logger.record_execution(
                    tool_name=name,
                    parameters=parameters,
                    risk_level=RiskTier.TIER_4_PROHIBITED.value,
                    user_decision=Decision.BLOCKED.value,
                    status=ExecutionStatus.ERROR.value,
                    duration_ms=duration,
                    error_message=err_msg,
                    session_id=context.session_id,
                )
            return ToolExecutionResponse(
                success=False,
                summary=err_msg,
                error=err_msg,
                recovery_options=["Call only tools available in the catalog"],
                risk_tier=RiskTier.TIER_4_PROHIBITED.value,
            )

        # 1. Prohibited operations check
        if tool.risk_tier == RiskTier.TIER_4_PROHIBITED:
            err_msg = f"Action '{name}' is categorized as Tier 4 (Prohibited) and cannot be executed."
            duration = (time.time() - start_time) * 1000.0
            if audit_logger:
                await audit_logger.record_execution(
                    tool_name=name,
                    parameters=parameters,
                    risk_level=tool.risk_tier.value,
                    user_decision=Decision.BLOCKED.value,
                    status=ExecutionStatus.ERROR.value,
                    duration_ms=duration,
                    error_message=err_msg,
                    session_id=context.session_id,
                )
            return ToolExecutionResponse(
                success=False,
                summary=err_msg,
                error=err_msg,
                risk_tier=tool.risk_tier.value,
            )

        # 2. Input validation
        try:
            validated_args = tool.args_schema(**parameters)
        except ValidationError as val_err:
            duration = (time.time() - start_time) * 1000.0
            err_details = val_err.errors()
            err_msg = f"Invalid parameters for tool '{name}': {err_details}"
            if audit_logger:
                await audit_logger.record_execution(
                    tool_name=name,
                    parameters=parameters,
                    risk_level=tool.risk_tier.value,
                    user_decision=Decision.BLOCKED.value,
                    status=ExecutionStatus.ERROR.value,
                    duration_ms=duration,
                    error_message=err_msg,
                    session_id=context.session_id,
                )
            return ToolExecutionResponse(
                success=False,
                summary=f"Validation failed for tool '{name}' arguments.",
                error=err_msg,
                recovery_options=["Ensure arguments match the tool input schema"],
                risk_tier=tool.risk_tier.value,
            )

        # 3. Policy and Human Confirmation Gate
        confirmation_reason = self.is_confirmation_required(tool, parameters, context)
        if confirmation_reason and not context.user_confirmed:
            call_id = str(uuid.uuid4())
            diff_preview = None
            if "content" in parameters:
                diff_preview = f"+ {parameters.get('content', '')[:500]}"
            elif "url" in parameters:
                diff_preview = f"Target URL: {parameters.get('url')}"
            elif "app_name" in parameters:
                diff_preview = f"Target App: {parameters.get('app_name')} (Args: {parameters.get('args', [])})"

            pending = PendingAction(
                call_id=call_id,
                tool_name=name,
                parameters=parameters,
                context=context,
                risk_tier=tool.risk_tier,
                reason=confirmation_reason,
                diff_preview=diff_preview,
            )
            self._pending_confirmations[call_id] = pending

            proposal = ToolConfirmationProposal(
                call_id=call_id,
                tool_name=name,
                parameters=parameters,
                risk_tier=tool.risk_tier.value,
                reason=confirmation_reason,
                diff_preview=diff_preview,
            )

            return ToolExecutionResponse(
                success=False,
                summary=f"Action paused: {confirmation_reason} User confirmation required.",
                risk_tier=tool.risk_tier.value,
                requires_confirmation=True,
                confirmation_proposal=proposal,
            )

        # 4. Tool Execution with Timeout and Cancellation support
        user_decision = Decision.USER_APPROVED if context.user_confirmed else Decision.AUTO_APPROVED
        status = ExecutionStatus.SUCCESS
        result: Optional[ToolResult] = None
        error_message: Optional[str] = None

        try:
            result = await asyncio.wait_for(
                tool.execute(validated_args, context),
                timeout=context.timeout,
            )
            if not result.success:
                status = ExecutionStatus.ERROR
                error_message = result.error
        except asyncio.TimeoutError:
            status = ExecutionStatus.TIMEOUT
            error_message = f"Tool execution timed out after {context.timeout} seconds."
            result = ToolResult(
                success=False,
                summary=error_message,
                error=error_message,
                recovery_options=["Increase tool timeout setting", "Try running a simpler query"],
                risk_tier=tool.risk_tier,
            )
        except asyncio.CancelledError:
            status = ExecutionStatus.CANCELLED
            error_message = "Tool execution was cancelled."
            result = ToolResult(
                success=False,
                summary=error_message,
                error=error_message,
                risk_tier=tool.risk_tier,
            )
            raise
        except Exception as exc:
            status = ExecutionStatus.ERROR
            error_message = str(exc)
            result = ToolResult(
                success=False,
                summary=f"Unexpected error executing tool '{name}': {exc}",
                error=str(exc),
                risk_tier=tool.risk_tier,
            )

        duration = (time.time() - start_time) * 1000.0

        # 5. Audit Logging
        if audit_logger:
            await audit_logger.record_execution(
                tool_name=name,
                parameters=parameters,
                risk_level=tool.risk_tier.value,
                user_decision=user_decision.value,
                status=status.value,
                duration_ms=duration,
                result_summary=result.summary if result else None,
                error_message=error_message,
                session_id=context.session_id,
            )

        return ToolExecutionResponse(
            success=result.success,
            data=result.data,
            summary=result.summary,
            error=result.error,
            recovery_options=result.recovery_options,
            risk_tier=tool.risk_tier.value,
            requires_confirmation=False,
        )

    async def confirm_execution(
        self,
        call_id: str,
        approved: bool,
        audit_logger: Optional[AuditLogger] = None,
    ) -> ToolExecutionResponse:
        """Resolve a pending confirmation proposal."""
        pending = self._pending_confirmations.pop(call_id, None)
        if not pending:
            return ToolExecutionResponse(
                success=False,
                summary="Pending confirmation proposal expired or not found.",
                error="INVALID_CONFIRMATION_ID",
                risk_tier=RiskTier.TIER_1_READ_ONLY.value,
            )

        if not approved:
            # User rejected
            if audit_logger:
                await audit_logger.record_execution(
                    tool_name=pending.tool_name,
                    parameters=pending.parameters,
                    risk_level=pending.risk_tier.value,
                    user_decision=Decision.REJECTED.value,
                    status=ExecutionStatus.CANCELLED.value,
                    duration_ms=0.0,
                    result_summary=f"User rejected action: {pending.reason}",
                    session_id=pending.context.session_id,
                )
            return ToolExecutionResponse(
                success=False,
                summary=f"Action '{pending.tool_name}' was rejected by the user.",
                error="USER_REJECTED",
                risk_tier=pending.risk_tier.value,
                requires_confirmation=False,
            )

        # Approved by user: execute with user_confirmed=True
        pending.context.user_confirmed = True
        return await self.execute_tool(
            name=pending.tool_name,
            parameters=pending.parameters,
            context=pending.context,
            audit_logger=audit_logger,
        )
