import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from aura_agent.models.db import ToolAuditModel

logger = logging.getLogger("aura.tools.audit")


class AuditLogger:
    """Records immutable audit logs of tool execution in SQLite with sensitive data redaction."""

    SENSITIVE_KEY_SUBSTRINGS = {
        "pass",
        "secret",
        "token",
        "key",
        "credential",
        "auth",
        "bearer",
        "private",
    }

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self.session_factory = session_factory

    def sanitize_dict(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Deeply redact sensitive fields and truncate oversized text values."""
        sanitized = {}
        for k, v in data.items():
            k_lower = k.lower()
            if any(sub in k_lower for sub in self.SENSITIVE_KEY_SUBSTRINGS):
                sanitized[k] = "[REDACTED]"
            elif isinstance(v, dict):
                sanitized[k] = self.sanitize_dict(v)
            elif isinstance(v, list):
                sanitized[k] = [
                    self.sanitize_dict(item) if isinstance(item, dict) else item
                    for item in v
                ]
            elif isinstance(v, str) and len(v) > 500:
                sanitized[k] = v[:500] + "... [TRUNCATED]"
            else:
                sanitized[k] = v
        return sanitized

    async def record_execution(
        self,
        tool_name: str,
        parameters: Dict[str, Any],
        risk_level: str,
        user_decision: str,
        status: str,
        duration_ms: float = 0.0,
        result_summary: Optional[str] = None,
        error_message: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> ToolAuditModel:
        """Persist an audit entry to the database."""
        safe_params = self.sanitize_dict(parameters)
        params_json = json.dumps(safe_params, default=str)

        log_entry = ToolAuditModel(
            session_id=session_id,
            tool_name=tool_name,
            parameters_json=params_json,
            risk_level=risk_level,
            user_decision=user_decision,
            status=status,
            duration_ms=duration_ms,
            result_summary=result_summary,
            error_message=error_message,
            created_at=datetime.now(timezone.utc),
        )

        try:
            async with self.session_factory() as session:
                async with session.begin():
                    session.add(log_entry)
                await session.refresh(log_entry)
            return log_entry
        except Exception as exc:
            logger.error("Failed to write tool audit log: %s", exc)
            return log_entry

    async def get_logs(
        self,
        limit: int = 50,
        session_id: Optional[str] = None,
        tool_name: Optional[str] = None,
    ) -> List[ToolAuditModel]:
        """Fetch audit log records sorted newest first."""
        async with self.session_factory() as session:
            stmt = select(ToolAuditModel).order_by(desc(ToolAuditModel.created_at)).limit(limit)
            if session_id:
                stmt = stmt.where(ToolAuditModel.session_id == session_id)
            if tool_name:
                stmt = stmt.where(ToolAuditModel.tool_name == tool_name)
            result = await session.execute(stmt)
            return list(result.scalars().all())
