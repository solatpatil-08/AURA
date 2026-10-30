import asyncio
import os
import pathlib
import pytest
import pytest_asyncio
import httpx
from unittest.mock import patch, MagicMock

from aura_agent.tools.base import ExecutionContext, RiskTier, Decision, ExecutionStatus
from aura_agent.tools.security import (
    PathJail,
    ApplicationAllowlist,
    URLValidator,
    SecurityViolationError,
)
from aura_agent.tools.audit import AuditLogger
from aura_agent.tools.registry import ToolRegistry
from aura_agent.tools.builtin.get_current_time import GetCurrentTimeTool, GetCurrentTimeArgs
from aura_agent.tools.builtin.list_files import ListFilesTool, ListFilesArgs
from aura_agent.tools.builtin.search_files import SearchFilesTool, SearchFilesArgs
from aura_agent.tools.builtin.read_file import ReadFileTool, ReadFileArgs
from aura_agent.tools.builtin.create_note import CreateNoteTool, CreateNoteArgs
from aura_agent.tools.builtin.create_folder import CreateFolderTool, CreateFolderArgs
from aura_agent.tools.builtin.open_allowlisted_app import OpenAllowlistedAppTool, OpenAppArgs
from aura_agent.tools.builtin.open_approved_url import OpenApprovedUrlTool, OpenUrlArgs
from aura_agent.tools import create_default_registry
from aura_agent.services.agent_loop import AgentLoop


# ---------------------------------------------------------------------------
# 1. SECURITY & JAIL UNIT TESTS
# ---------------------------------------------------------------------------

def test_path_jail_workspace_containment(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    # Valid relative file
    validated = jail.validate_path("sample.txt")
    assert validated.exists()
    assert validated == (mock_workspace / "sample.txt").resolve()

    # Valid subfolder file
    validated_nested = jail.validate_path("subfolder/nested.txt")
    assert validated_nested.exists()


def test_path_jail_traversal_rejection(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    # Path traversal attempting to escape workspace
    with pytest.raises(SecurityViolationError, match="escapes allowed workspace roots"):
        jail.validate_path("../../Windows/System32/notepad.exe")

    with pytest.raises(SecurityViolationError, match="escapes allowed workspace roots"):
        jail.validate_path("../outside.txt")


def test_path_jail_prohibited_system_paths(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    with pytest.raises(SecurityViolationError, match="Access to protected system directory is prohibited"):
        jail.validate_path("C:/Windows/System32/cmd.exe", allow_outside_workspace=True)

    with pytest.raises(SecurityViolationError, match="Access to protected system directory is prohibited"):
        jail.validate_path(pathlib.Path.home() / ".ssh" / "id_rsa", allow_outside_workspace=True)


def test_path_jail_prohibited_filenames(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    # Sensitive file names (.env, credentials) are blocked even if inside workspace
    (mock_workspace / ".env").write_text("SECRET=12345", encoding="utf-8")
    with pytest.raises(SecurityViolationError, match="credential or secret file"):
        jail.validate_path(".env")


def test_path_jail_validate_file_for_read_size_limit(mock_workspace):
    # Set 1KB max limit for testing
    jail = PathJail(allowed_workspaces=[mock_workspace], max_file_bytes=100)
    big_file = mock_workspace / "big.txt"
    big_file.write_text("A" * 200, encoding="utf-8")

    with pytest.raises(SecurityViolationError, match="File size .* exceeds maximum allowable limit"):
        jail.validate_file_for_read("big.txt")


def test_path_jail_rejects_binary_file(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    bin_file = mock_workspace / "sample.bin"
    bin_file.write_bytes(b"\x00\x01\x02\x03\x00")

    with pytest.raises(SecurityViolationError, match="Binary file reading is prohibited"):
        jail.validate_file_for_read("sample.bin")


def test_application_allowlist_enforcement():
    allowlist = ApplicationAllowlist(allowed_apps={"notepad": "C:\\Windows\\System32\\notepad.exe"})

    # Approved app
    exe, args = allowlist.validate_app_execution("notepad", ["file.txt"])
    assert exe == "C:\\Windows\\System32\\notepad.exe"
    assert args == ["file.txt"]

    # Prohibited shell interpreters
    for shell_cmd in ["cmd", "powershell", "pwsh", "bash", "sh"]:
        with pytest.raises(SecurityViolationError, match="strictly prohibited"):
            allowlist.validate_app_execution(shell_cmd)

    # Unlisted app
    with pytest.raises(SecurityViolationError, match="is not in the allowlist"):
        allowlist.validate_app_execution("unknown_malware.exe")

    # Command injection chars in arguments
    for bad_arg in ["foo & bar", "foo; rm -rf", "foo | cat", "foo `calc`", "foo > out"]:
        with pytest.raises(SecurityViolationError, match="illegal shell metacharacters"):
            allowlist.validate_app_execution("notepad", [bad_arg])


def test_url_validator():
    # Valid URLs
    assert URLValidator.validate_url("https://example.com") == "https://example.com"
    assert URLValidator.validate_url("http://localhost:3000/docs") == "http://localhost:3000/docs"

    # Prohibited schemes
    for bad_url in [
        "file:///C:/Windows/System32/cmd.exe",
        "javascript:alert(1)",
        "data:text/html,<html>",
        "chrome://settings",
    ]:
        with pytest.raises(SecurityViolationError, match="scheme .* is prohibited"):
            URLValidator.validate_url(bad_url)

    # Empty URL or missing host
    with pytest.raises(SecurityViolationError):
        URLValidator.validate_url("https://")

    # URL with embedded credentials
    with pytest.raises(SecurityViolationError, match="embedded authentication credentials"):
        URLValidator.validate_url("https://admin:password123@example.com")


# ---------------------------------------------------------------------------
# 2. INDIVIDUAL TOOL UNIT TESTS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tool_get_current_time():
    tool = GetCurrentTimeTool()
    ctx = ExecutionContext()

    # Local time
    res = await tool.execute(GetCurrentTimeArgs(), ctx)
    assert res.success is True
    assert "time" in res.data
    assert "date" in res.data
    assert "timezone" in res.data

    # Specific timezone
    res_utc = await tool.execute(GetCurrentTimeArgs(timezone_name="UTC"), ctx)
    assert res_utc.success is True
    assert res_utc.data["timezone"] == "UTC"

    # Invalid timezone
    res_bad = await tool.execute(GetCurrentTimeArgs(timezone_name="Invalid/Timezone_XXX"), ctx)
    assert res_bad.success is False
    assert res_bad.recovery_options is not None


@pytest.mark.asyncio
async def test_tool_list_files(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    tool = ListFilesTool(path_jail=jail)
    ctx = ExecutionContext()

    # Top-level listing
    res = await tool.execute(ListFilesArgs(relative_path="."), ctx)
    assert res.success is True
    entries = res.data["entries"]
    names = [e["name"] for e in entries]
    assert "sample.txt" in names
    assert "subfolder" in names

    # Recursive listing
    res_rec = await tool.execute(ListFilesArgs(relative_path=".", recursive=True), ctx)
    assert res_rec.success is True
    rec_names = [e["name"] for e in res_rec.data["entries"]]
    assert "nested.txt" in rec_names

    # Path traversal rejected
    res_trav = await tool.execute(ListFilesArgs(relative_path="../../"), ctx)
    assert res_trav.success is False
    assert "Security violation" in res_trav.summary


@pytest.mark.asyncio
async def test_tool_search_files(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    tool = SearchFilesTool(path_jail=jail)
    ctx = ExecutionContext()

    # Substring search
    res = await tool.execute(SearchFilesArgs(query="sample"), ctx)
    assert res.success is True
    assert res.data["count"] == 1
    assert res.data["matches"][0]["name"] == "sample.txt"

    # Glob search
    res_glob = await tool.execute(SearchFilesArgs(query="*.txt"), ctx)
    assert res_glob.success is True
    assert res_glob.data["count"] >= 2

    # Zero matches
    res_none = await tool.execute(SearchFilesArgs(query="non_existent_file_xyz"), ctx)
    assert res_none.success is True
    assert res_none.data["count"] == 0


@pytest.mark.asyncio
async def test_tool_read_file(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    tool = ReadFileTool(path_jail=jail)
    ctx = ExecutionContext()

    # Valid read
    res = await tool.execute(ReadFileArgs(relative_path="sample.txt"), ctx)
    assert res.success is True
    assert res.data["content"] == "Hello from AURA test file."
    assert res.data["total_lines"] == 1

    # Missing file
    res_missing = await tool.execute(ReadFileArgs(relative_path="does_not_exist.txt"), ctx)
    assert res_missing.success is False
    assert "not found" in res_missing.summary.lower()

    # Attempting to read directory
    res_dir = await tool.execute(ReadFileArgs(relative_path="subfolder"), ctx)
    assert res_dir.success is False


@pytest.mark.asyncio
async def test_tool_create_note(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    notes_dir = mock_workspace / "notes"
    tool = CreateNoteTool(path_jail=jail, notes_dir=notes_dir)

    # Initial creation
    ctx = ExecutionContext(policy="request-review", user_confirmed=False)
    res = await tool.execute(CreateNoteArgs(title="Architectural Ideas", content="Note content."), ctx)
    assert res.success is True
    assert (notes_dir / "Architectural-Ideas.md").exists()

    # Overwrite attempt without confirmation when policy is request-review
    res_overwrite = await tool.execute(CreateNoteArgs(title="Architectural Ideas", content="New content."), ctx)
    assert res_overwrite.success is False
    assert "overwrite requires confirmation" in res_overwrite.summary.lower()

    # Overwrite attempt WITH user confirmation
    ctx_confirmed = ExecutionContext(policy="request-review", user_confirmed=True)
    res_overwrite_ok = await tool.execute(CreateNoteArgs(title="Architectural Ideas", content="New content."), ctx_confirmed)
    assert res_overwrite_ok.success is True
    assert res_overwrite_ok.data["overwritten"] is True


@pytest.mark.asyncio
async def test_tool_create_folder(mock_workspace):
    jail = PathJail(allowed_workspaces=[mock_workspace])
    tool = CreateFolderTool(path_jail=jail)
    ctx = ExecutionContext()

    res = await tool.execute(CreateFolderArgs(relative_path="new_project/src"), ctx)
    assert res.success is True
    assert (mock_workspace / "new_project" / "src").is_dir()

    # Already existing folder
    res_dup = await tool.execute(CreateFolderArgs(relative_path="new_project/src"), ctx)
    assert res_dup.success is True
    assert res_dup.data["already_existed"] is True


@pytest.mark.asyncio
async def test_tool_open_allowlisted_app():
    allowlist = ApplicationAllowlist(allowed_apps={"calc": "calc.exe"})
    tool = OpenAllowlistedAppTool(allowlist=allowlist)

    # Blocked without user confirmation under request-review
    ctx_unconfirmed = ExecutionContext(policy="request-review", user_confirmed=False)
    res_blocked = await tool.execute(OpenAppArgs(app_name="calc"), ctx_unconfirmed)
    assert res_blocked.success is False
    assert "requires explicit user confirmation" in res_blocked.summary

    # Allowed when confirmed
    ctx_confirmed = ExecutionContext(policy="request-review", user_confirmed=True)
    with patch("subprocess.Popen") as mock_popen:
        mock_proc = MagicMock()
        mock_proc.pid = 9999
        mock_popen.return_value = mock_proc

        res_ok = await tool.execute(OpenAppArgs(app_name="calc"), ctx_confirmed)
        assert res_ok.success is True
        import subprocess
        mock_popen.assert_called_once_with(
            ["calc.exe"],
            shell=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


@pytest.mark.asyncio
async def test_tool_open_approved_url():
    tool = OpenApprovedUrlTool()

    # Blocked without user confirmation
    ctx_unconfirmed = ExecutionContext(policy="request-review", user_confirmed=False)
    res_blocked = await tool.execute(OpenUrlArgs(url="https://github.com"), ctx_unconfirmed)
    assert res_blocked.success is False
    assert "requires user approval" in res_blocked.summary

    # Allowed when confirmed
    ctx_confirmed = ExecutionContext(policy="request-review", user_confirmed=True)
    with patch("webbrowser.open", return_value=True) as mock_wb:
        res_ok = await tool.execute(OpenUrlArgs(url="https://github.com"), ctx_confirmed)
        assert res_ok.success is True
        mock_wb.assert_called_once_with("https://github.com")


# ---------------------------------------------------------------------------
# 3. REGISTRY, AUDIT LOGGING, & TIMEOUT TESTS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tool_registry_policy_and_confirmation(mock_workspace, in_memory_db):
    audit_logger = AuditLogger(in_memory_db)
    registry = create_default_registry(workspace_root=str(mock_workspace))

    # Tier 1 tools auto-proceed
    ctx = ExecutionContext(policy="request-review", user_confirmed=False)
    resp = await registry.execute_tool("get_current_time", {}, ctx, audit_logger=audit_logger)
    assert resp.success is True
    assert resp.requires_confirmation is False

    # Tier 3 tools require confirmation under request-review
    resp_t3 = await registry.execute_tool(
        "open_approved_url",
        {"url": "https://python.org"},
        ctx,
        audit_logger=audit_logger,
    )
    assert resp_t3.success is False
    assert resp_t3.requires_confirmation is True
    assert resp_t3.confirmation_proposal is not None
    call_id = resp_t3.confirmation_proposal.call_id

    # Confirm and execute
    with patch("webbrowser.open", return_value=True):
        confirm_resp = await registry.confirm_execution(call_id=call_id, approved=True, audit_logger=audit_logger)
        assert confirm_resp.success is True
        assert confirm_resp.requires_confirmation is False

    # Check audit logs in SQLite
    logs = await audit_logger.get_logs(limit=10)
    assert len(logs) >= 2
    tool_names = [l.tool_name for l in logs]
    assert "get_current_time" in tool_names
    assert "open_approved_url" in tool_names


@pytest.mark.asyncio
async def test_tool_execution_timeout(mock_workspace, in_memory_db):
    audit_logger = AuditLogger(in_memory_db)
    registry = create_default_registry(workspace_root=str(mock_workspace))

    # Create a dummy slow tool
    from aura_agent.tools.base import BaseTool, ToolResult
    from pydantic import BaseModel

    class SlowArgs(BaseModel):
        delay: float = 1.0

    class SlowTool(BaseTool):
        name = "slow_tool"
        description = "Intentionally slow tool for timeout testing."
        risk_tier = RiskTier.TIER_1_READ_ONLY
        args_schema = SlowArgs

        async def execute(self, args: SlowArgs, context: ExecutionContext) -> ToolResult:
            await asyncio.sleep(args.delay)
            return ToolResult(success=True, summary="Finished sleeping")

    registry.register(SlowTool())

    # Set 0.05s timeout
    ctx = ExecutionContext(timeout=0.05)
    resp = await registry.execute_tool("slow_tool", {"delay": 1.0}, ctx, audit_logger=audit_logger)
    assert resp.success is False
    assert "timed out" in resp.summary.lower()

    # Verify TIMEOUT logged in audit database
    logs = await audit_logger.get_logs(tool_name="slow_tool")
    assert len(logs) == 1
    assert logs[0].status == ExecutionStatus.TIMEOUT.value


@pytest.mark.asyncio
async def test_audit_logger_redacts_secrets(in_memory_db):
    audit_logger = AuditLogger(in_memory_db)
    params = {
        "user": "developer",
        "api_key": "super_secret_token_12345",
        "nested": {
            "password": "mypassword",
            "safe_val": 42,
        },
    }

    log_entry = await audit_logger.record_execution(
        tool_name="test_tool",
        parameters=params,
        risk_level=RiskTier.TIER_1_READ_ONLY.value,
        user_decision=Decision.AUTO_APPROVED.value,
        status=ExecutionStatus.SUCCESS.value,
    )

    import json
    saved_params = json.loads(log_entry.parameters_json)
    assert saved_params["user"] == "developer"
    assert saved_params["api_key"] == "[REDACTED]"
    assert saved_params["nested"]["password"] == "[REDACTED]"
    assert saved_params["nested"]["safe_val"] == 42


# ---------------------------------------------------------------------------
# 4. AGENT LOOP & MULTI-TURN REASONING TESTS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_agent_loop_executes_tool_and_answers(mock_workspace, in_memory_db):
    from tests.conftest import MockOllamaClient

    audit_logger = AuditLogger(in_memory_db)
    tool_registry = create_default_registry(workspace_root=str(mock_workspace))

    # Mock Ollama returning tool_calls on turn 1, then natural answer on turn 2
    turn_1_response = {
        "content": "",
        "tool_calls": [
            {
                "function": {
                    "name": "get_current_time",
                    "arguments": {},
                }
            }
        ],
        "model": "qwen3.5:4b",
    }
    turn_2_response = {
        "content": "The current time has been checked successfully.",
        "tool_calls": [],
        "model": "qwen3.5:4b",
    }

    class ToolCallingMockOllama(MockOllamaClient):
        def __init__(self):
            super().__init__()
            self.call_count = 0

        async def chat(self, messages, model, system_prompt=None, tools=None):
            self.call_count += 1
            if self.call_count == 1:
                return turn_1_response
            return turn_2_response

    mock_ollama = ToolCallingMockOllama()
    agent_loop = AgentLoop(
        ollama_client=mock_ollama,
        tool_registry=tool_registry,
        audit_logger=audit_logger,
        max_iterations=5,
    )

    res = await agent_loop.run_turn(
        session_id="test-sess",
        messages=[{"role": "user", "content": "What time is it?"}],
        model="qwen3.5:4b",
    )

    assert res["done"] is True
    assert res["requires_confirmation"] is False
    assert len(res["tool_calls_executed"]) == 1
    assert res["tool_calls_executed"][0]["name"] == "get_current_time"
    assert "current time has been checked" in res["content"]


# ---------------------------------------------------------------------------
# 5. FASTAPI HTTP ENDPOINTS TESTS
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_api_tools_catalog(client: httpx.AsyncClient):
    response = await client.get("/api/tools/catalog")
    assert response.status_code == 200
    catalog = response.json()
    assert len(catalog) >= 8
    names = [t["name"] for t in catalog]
    assert "get_current_time" in names
    assert "list_files" in names
    assert "search_files" in names
    assert "read_file" in names
    assert "create_note" in names
    assert "create_folder" in names
    assert "open_allowlisted_app" in names
    assert "open_approved_url" in names


@pytest.mark.asyncio
async def test_api_tools_execute_endpoint(client: httpx.AsyncClient):
    payload = {
        "tool_name": "get_current_time",
        "parameters": {},
        "user_confirmed": False,
    }
    response = await client.post("/api/tools/execute", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "time" in data["data"]


@pytest.mark.asyncio
async def test_api_tools_confirmation_flow(client: httpx.AsyncClient):
    # Execute a tool that requires confirmation (open_approved_url)
    payload = {
        "tool_name": "open_approved_url",
        "parameters": {"url": "https://google.com"},
        "user_confirmed": False,
    }
    exec_resp = await client.post("/api/tools/execute", json=payload)
    assert exec_resp.status_code == 200
    exec_data = exec_resp.json()
    assert exec_data["requires_confirmation"] is True
    call_id = exec_data["confirmation_proposal"]["call_id"]

    # Reject confirmation
    reject_resp = await client.post("/api/tools/confirm", json={"call_id": call_id, "approved": False})
    assert reject_resp.status_code == 200
    reject_data = reject_resp.json()
    assert reject_data["success"] is False
    assert reject_data["error"] == "USER_REJECTED"


@pytest.mark.asyncio
async def test_api_tools_audit_endpoint(client: httpx.AsyncClient):
    # Execute a tool to produce an audit record
    await client.post("/api/tools/execute", json={"tool_name": "get_current_time", "parameters": {}})

    response = await client.get("/api/tools/audit?limit=10")
    assert response.status_code == 200
    logs = response.json()
    assert len(logs) >= 1
    assert logs[0]["tool_name"] == "get_current_time"
