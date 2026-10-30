import abc
from enum import Enum
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel, Field


class RiskTier(str, Enum):
    """Deterministic risk classification for tools."""
    TIER_1_READ_ONLY = "TIER_1_READ_ONLY"          # Safe read-only inspection (auto-approved in workspace)
    TIER_2_MONITORED_WRITE = "TIER_2_MONITORED_WRITE"  # Local scoped write (requires review by default)
    TIER_3_SYSTEM_EXTERNAL = "TIER_3_SYSTEM_EXTERNAL"  # External app / URL launching (mandatory confirmation)
    TIER_4_PROHIBITED = "TIER_4_PROHIBITED"        # Blocked system commands / unrestricted shells


class Decision(str, Enum):
    """Audit outcome for tool authorization."""
    AUTO_APPROVED = "AUTO_APPROVED"
    USER_APPROVED = "USER_APPROVED"
    REJECTED = "REJECTED"
    BLOCKED = "BLOCKED"


class ExecutionStatus(str, Enum):
    """Terminal state of tool execution."""
    SUCCESS = "SUCCESS"
    ERROR = "ERROR"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"


class ExecutionContext(BaseModel):
    """Runtime context passed to tools during execution."""
    session_id: Optional[str] = None
    policy: str = "request-review"  # 'strict' | 'request-review' | 'always-proceed'
    user_confirmed: bool = False
    timeout: float = 10.0
    cancelled: bool = False


class ToolResult(BaseModel):
    """Structured, verified result from a tool execution."""
    success: bool
    data: Any = None
    summary: str
    error: Optional[str] = None
    recovery_options: Optional[List[str]] = None
    risk_tier: RiskTier = RiskTier.TIER_1_READ_ONLY


class BaseTool(abc.ABC):
    """Abstract base class for all AURA typed tools."""

    name: str
    description: str
    risk_tier: RiskTier
    args_schema: Type[BaseModel]

    @abc.abstractmethod
    async def execute(self, args: BaseModel, context: ExecutionContext) -> ToolResult:
        """Execute the tool with validated arguments and runtime context."""
        pass

    def to_ollama_tool(self) -> Dict[str, Any]:
        """Convert tool definition into Ollama / OpenAI function format."""
        schema = self.args_schema.model_json_schema()
        # Clean schema title and descriptions if needed
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": schema.get("properties", {}),
                    "required": schema.get("required", []),
                },
            },
        }
