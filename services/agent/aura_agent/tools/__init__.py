import pathlib
from typing import Any, Optional
from aura_agent.config import settings
from aura_agent.tools.base import (
    BaseTool,
    Decision,
    ExecutionContext,
    ExecutionStatus,
    RiskTier,
    ToolResult,
)
from aura_agent.tools.security import (
    ApplicationAllowlist,
    PathJail,
    SecurityViolationError,
    URLValidator,
)
from aura_agent.tools.audit import AuditLogger
from aura_agent.tools.registry import ToolRegistry
from aura_agent.tools.builtin.get_current_time import GetCurrentTimeTool
from aura_agent.tools.builtin.list_files import ListFilesTool
from aura_agent.tools.builtin.search_files import SearchFilesTool
from aura_agent.tools.builtin.read_file import ReadFileTool
from aura_agent.tools.builtin.create_note import CreateNoteTool
from aura_agent.tools.builtin.create_folder import CreateFolderTool
from aura_agent.tools.builtin.open_allowlisted_app import OpenAllowlistedAppTool
from aura_agent.tools.builtin.open_approved_url import OpenApprovedUrlTool
from aura_agent.tools.builtin.web_search import WebSearchTool
from aura_agent.tools.builtin.read_web_page import ReadWebPageTool
from aura_agent.tools.builtin.research_topic import ResearchTopicTool
from aura_agent.tools.builtin.save_memory import SaveMemoryTool
from aura_agent.tools.builtin.recall_memory import RecallMemoryTool
from aura_agent.tools.builtin.forget_memory import ForgetMemoryTool
from aura_agent.services.browser import BrowserService


def create_default_registry(
    workspace_root: Optional[str] = None,
    notes_dir: Optional[str] = None,
    allowed_apps: Optional[dict] = None,
    browser_service: Optional[BrowserService] = None,
    ollama_client: Optional[Any] = None,
    memory_service: Optional[Any] = None,
) -> ToolRegistry:
    """Factory creating a fully-configured ToolRegistry with all safe tools including browser research."""
    ws_path = pathlib.Path(workspace_root or settings.workspace_root).resolve()
    notes_path = pathlib.Path(notes_dir or (ws_path / "notes")).resolve()

    # Ensure notes directory exists
    notes_path.mkdir(parents=True, exist_ok=True)

    # Initialize security guards
    path_jail = PathJail(
        allowed_workspaces=[ws_path],
        notes_dir=notes_path,
        max_file_bytes=settings.max_file_read_bytes,
    )
    app_allowlist = ApplicationAllowlist(allowed_apps=allowed_apps or settings.allowed_applications)

    # Initialize or use browser service
    browser = browser_service or BrowserService(
        user_data_dir=settings.browser_user_data_dir,
        headless=settings.browser_headless,
        timeout_seconds=settings.browser_timeout_seconds,
        max_content_chars=settings.browser_max_content_chars,
        domain_allowlist=settings.browser_domain_allowlist,
    )

    registry = ToolRegistry()

    # Register Phase 5 local tools
    registry.register(GetCurrentTimeTool())
    registry.register(ListFilesTool(path_jail=path_jail))
    registry.register(SearchFilesTool(path_jail=path_jail))
    registry.register(ReadFileTool(path_jail=path_jail))
    registry.register(CreateNoteTool(path_jail=path_jail, notes_dir=notes_path))
    registry.register(CreateFolderTool(path_jail=path_jail))
    registry.register(OpenAllowlistedAppTool(allowlist=app_allowlist))
    registry.register(OpenApprovedUrlTool())

    # Register Phase 6 browser research tools
    registry.register(WebSearchTool(browser_service=browser))
    registry.register(ReadWebPageTool(browser_service=browser))
    registry.register(ResearchTopicTool(browser_service=browser, ollama_client=ollama_client))

    # Register Phase 7 persistent local memory tools
    if memory_service:
        registry.register(SaveMemoryTool(memory_service=memory_service))
        registry.register(RecallMemoryTool(memory_service=memory_service))
        registry.register(ForgetMemoryTool(memory_service=memory_service))

    return registry


__all__ = [
    "BaseTool",
    "RiskTier",
    "Decision",
    "ExecutionStatus",
    "ExecutionContext",
    "ToolResult",
    "PathJail",
    "ApplicationAllowlist",
    "URLValidator",
    "SecurityViolationError",
    "AuditLogger",
    "ToolRegistry",
    "create_default_registry",
]
