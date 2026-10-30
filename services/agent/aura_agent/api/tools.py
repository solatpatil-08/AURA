import json
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from aura_agent.config import settings
from aura_agent.models.schemas import (
    ToolAuditLogSchema,
    ToolConfirmationRequest,
    ToolDefinitionSchema,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from aura_agent.tools import ToolRegistry, AuditLogger, ExecutionContext

logger = logging.getLogger("aura.api.tools")
router = APIRouter(prefix="/api/tools", tags=["Tools & Computer Actions"])


def get_tool_registry(request: Request) -> ToolRegistry:
    return request.app.state.tool_registry


def get_audit_logger(request: Request) -> AuditLogger:
    return request.app.state.audit_logger


@router.get("/catalog", response_model=List[ToolDefinitionSchema])
async def get_tool_catalog(
    registry: ToolRegistry = Depends(get_tool_registry),
):
    """Retrieve catalog of all registered tools, their parameters, and risk tiers."""
    return registry.get_catalog()


@router.post("/execute", response_model=ToolExecutionResponse)
async def execute_tool(
    req: ToolExecutionRequest,
    registry: ToolRegistry = Depends(get_tool_registry),
    audit_logger: AuditLogger = Depends(get_audit_logger),
):
    """Directly execute a registered tool under configured permission policies with audit logging."""
    context = ExecutionContext(
        session_id=req.session_id,
        policy=settings.tool_execution_policy,
        user_confirmed=req.user_confirmed,
        timeout=settings.tool_timeout_seconds,
    )

    response = await registry.execute_tool(
        name=req.tool_name,
        parameters=req.parameters,
        context=context,
        audit_logger=audit_logger,
    )
    return response


@router.post("/confirm", response_model=ToolExecutionResponse)
async def confirm_tool_execution(
    req: ToolConfirmationRequest,
    registry: ToolRegistry = Depends(get_tool_registry),
    audit_logger: AuditLogger = Depends(get_audit_logger),
):
    """Approve or reject a pending tool execution proposal."""
    response = await registry.confirm_execution(
        call_id=req.call_id,
        approved=req.approved,
        audit_logger=audit_logger,
    )
    return response


@router.get("/audit", response_model=List[ToolAuditLogSchema])
async def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    session_id: Optional[str] = Query(default=None),
    tool_name: Optional[str] = Query(default=None),
    audit_logger: AuditLogger = Depends(get_audit_logger),
):
    """Retrieve recent immutable tool execution audit records from SQLite."""
    logs = await audit_logger.get_logs(limit=limit, session_id=session_id, tool_name=tool_name)
    results = []
    for log in logs:
        try:
            params = json.loads(log.parameters_json)
        except Exception:
            params = {}
        results.append(
            ToolAuditLogSchema(
                id=log.id,
                session_id=log.session_id,
                tool_name=log.tool_name,
                parameters=params,
                risk_level=log.risk_level,
                user_decision=log.user_decision,
                status=log.status,
                duration_ms=log.duration_ms,
                result_summary=log.result_summary,
                error_message=log.error_message,
                created_at=log.created_at.isoformat(),
            )
        )
    return results
