import os
import pathlib
from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import PathJail, SecurityViolationError


class ListFilesArgs(BaseModel):
    relative_path: str = Field(
        default=".",
        description="Path relative to the approved workspace root to list entries for.",
    )
    recursive: bool = Field(
        default=False,
        description="Whether to list entries recursively down directory trees.",
    )
    max_depth: int = Field(
        default=2,
        ge=1,
        le=5,
        description="Maximum recursion depth when recursive is true (1 to 5).",
    )


class ListFilesTool(BaseTool):
    """Tool to inspect files and directories inside the approved workspace."""

    name = "list_files"
    description = "List files and subdirectories inside an approved workspace root."
    risk_tier = RiskTier.TIER_1_READ_ONLY
    args_schema = ListFilesArgs

    def __init__(self, path_jail: PathJail):
        self.path_jail = path_jail

    async def execute(self, args: ListFilesArgs, context: ExecutionContext) -> ToolResult:
        try:
            target_dir = self.path_jail.validate_path(args.relative_path, must_exist=True)

            if not target_dir.is_dir():
                return ToolResult(
                    success=False,
                    summary=f"Path '{args.relative_path}' is not a directory.",
                    error=f"Expected directory at {target_dir}, but found file.",
                    recovery_options=["Use read_file to inspect file contents", "Provide a directory path"],
                    risk_tier=self.risk_tier,
                )

            entries = []
            primary_workspace = self.path_jail.allowed_workspaces[0]

            if not args.recursive:
                with os.scandir(target_dir) as it:
                    for entry in it:
                        try:
                            # Skip prohibited names
                            if entry.name.lower() in self.path_jail.PROHIBITED_FILENAMES:
                                continue
                            stat = entry.stat()
                            entry_path = pathlib.Path(entry.path)
                            rel_path = str(entry_path.relative_to(primary_workspace)) if primary_workspace in entry_path.parents or entry_path == primary_workspace else entry.name
                            entries.append({
                                "name": entry.name,
                                "path": rel_path,
                                "is_dir": entry.is_dir(),
                                "size_bytes": stat.st_size if not entry.is_dir() else None,
                                "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                            })
                        except (PermissionError, OSError):
                            continue
            else:
                base_depth = len(target_dir.parts)
                for root, dirs, files in os.walk(target_dir):
                    current_path = pathlib.Path(root)
                    current_depth = len(current_path.parts) - base_depth
                    if current_depth > args.max_depth:
                        dirs.clear()
                        continue

                    # Filter out hidden or prohibited directories in place
                    dirs[:] = [
                        d for d in dirs
                        if not d.startswith(".") and d.lower() not in self.path_jail.PROHIBITED_FILENAMES
                    ]

                    for d in dirs:
                        dir_path = current_path / d
                        rel = str(dir_path.relative_to(primary_workspace)) if primary_workspace in dir_path.parents or dir_path == primary_workspace else d
                        entries.append({
                            "name": d,
                            "path": rel,
                            "is_dir": True,
                            "size_bytes": None,
                        })

                    for f in files:
                        if f.lower() in self.path_jail.PROHIBITED_FILENAMES or f.startswith("."):
                            continue
                        f_path = current_path / f
                        try:
                            f_stat = f_path.stat()
                            rel = str(f_path.relative_to(primary_workspace)) if primary_workspace in f_path.parents or f_path == primary_workspace else f
                            entries.append({
                                "name": f,
                                "path": rel,
                                "is_dir": False,
                                "size_bytes": f_stat.st_size,
                                "modified_at": datetime.fromtimestamp(f_stat.st_mtime, timezone.utc).isoformat(),
                            })
                        except OSError:
                            continue

            # Sort directories first, then alphabetical
            entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

            summary = f"Found {len(entries)} items in '{args.relative_path}'."
            return ToolResult(
                success=True,
                data={"entries": entries, "count": len(entries), "base_path": args.relative_path},
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Ensure path stays inside approved workspace roots", "Do not attempt path traversal"],
                risk_tier=self.risk_tier,
            )
        except FileNotFoundError as fnf_err:
            return ToolResult(
                success=False,
                summary=f"Directory not found: {args.relative_path}",
                error=str(fnf_err),
                recovery_options=["Verify directory spelling and existence"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to list directory: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
