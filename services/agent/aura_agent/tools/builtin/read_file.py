import pathlib
from typing import Optional
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import PathJail, SecurityViolationError


class ReadFileArgs(BaseModel):
    relative_path: str = Field(
        ...,
        min_length=1,
        description="Path of the text or documentation file to read, relative to workspace root.",
    )
    max_lines: Optional[int] = Field(
        default=500,
        ge=1,
        le=2000,
        description="Maximum number of lines to read from the start of the file.",
    )


class ReadFileTool(BaseTool):
    """Tool to read permitted text and documentation files inside an approved workspace."""

    name = "read_file"
    description = "Read an explicitly permitted text, code, or documentation file inside the workspace (up to 5MB)."
    risk_tier = RiskTier.TIER_1_READ_ONLY
    args_schema = ReadFileArgs

    def __init__(self, path_jail: PathJail):
        self.path_jail = path_jail

    async def execute(self, args: ReadFileArgs, context: ExecutionContext) -> ToolResult:
        try:
            target_file = self.path_jail.validate_file_for_read(args.relative_path)
            primary_workspace = self.path_jail.allowed_workspaces[0]
            rel_display = str(target_file.relative_to(primary_workspace)) if primary_workspace in target_file.parents or target_file == primary_workspace else target_file.name

            lines = []
            total_lines = 0
            with open(target_file, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    total_lines += 1
                    if args.max_lines and len(lines) < args.max_lines:
                        lines.append(line)

            content = "".join(lines)
            truncated = total_lines > len(lines)

            summary = f"Read {len(lines)} lines from '{rel_display}' ({target_file.stat().st_size} bytes)."
            if truncated:
                summary += f" (Truncated; file has {total_lines} total lines)."

            return ToolResult(
                success=True,
                data={
                    "path": rel_display,
                    "content": content,
                    "lines_read": len(lines),
                    "total_lines": total_lines,
                    "truncated": truncated,
                    "size_bytes": target_file.stat().st_size,
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Only request text or documentation files located inside approved workspace roots"],
                risk_tier=self.risk_tier,
            )
        except FileNotFoundError as fnf_err:
            return ToolResult(
                success=False,
                summary=f"File not found: {args.relative_path}",
                error=str(fnf_err),
                recovery_options=["Verify the file path and name using search_files or list_files"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to read file: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
