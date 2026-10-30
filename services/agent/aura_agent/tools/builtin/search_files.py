import fnmatch
import os
import pathlib
from typing import List, Optional
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import PathJail, SecurityViolationError


class SearchFilesArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Search substring or glob pattern (e.g. '*.py', 'config', 'schema').",
    )
    relative_path: str = Field(
        default=".",
        description="Starting directory relative to the approved workspace root.",
    )
    max_results: int = Field(
        default=50,
        ge=1,
        le=200,
        description="Maximum number of search results to return.",
    )


class SearchFilesTool(BaseTool):
    """Tool to search filenames within an approved workspace root."""

    name = "search_files"
    description = "Search filenames matching a query substring or pattern inside an approved workspace."
    risk_tier = RiskTier.TIER_1_READ_ONLY
    args_schema = SearchFilesArgs

    def __init__(self, path_jail: PathJail):
        self.path_jail = path_jail

    async def execute(self, args: SearchFilesArgs, context: ExecutionContext) -> ToolResult:
        try:
            target_dir = self.path_jail.validate_path(args.relative_path, must_exist=True)
            if not target_dir.is_dir():
                return ToolResult(
                    success=False,
                    summary=f"Path '{args.relative_path}' is not a directory.",
                    error=f"Expected directory at {target_dir}",
                    recovery_options=["Provide a valid workspace directory"],
                    risk_tier=self.risk_tier,
                )

            query = args.query.strip()
            query_lower = query.lower()
            is_glob = any(ch in query for ch in ["*", "?", "[", "]"])

            results = []
            primary_workspace = self.path_jail.allowed_workspaces[0]

            for root, dirs, files in os.walk(target_dir):
                # Filter out hidden/prohibited dirs
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith(".") and d.lower() not in self.path_jail.PROHIBITED_FILENAMES
                ]

                current_path = pathlib.Path(root)

                for f in files:
                    if len(results) >= args.max_results:
                        break

                    if f.lower() in self.path_jail.PROHIBITED_FILENAMES or f.startswith("."):
                        continue

                    matched = False
                    if is_glob:
                        matched = fnmatch.fnmatch(f.lower(), query_lower)
                    else:
                        matched = query_lower in f.lower()

                    if matched:
                        file_path = current_path / f
                        try:
                            stat = file_path.stat()
                            rel = str(file_path.relative_to(primary_workspace)) if primary_workspace in file_path.parents or file_path == primary_workspace else str(file_path)
                            results.append({
                                "name": f,
                                "path": rel,
                                "size_bytes": stat.st_size,
                            })
                        except OSError:
                            continue

                if len(results) >= args.max_results:
                    break

            summary = f"Found {len(results)} matches for '{args.query}' in '{args.relative_path}'."
            return ToolResult(
                success=True,
                data={"query": args.query, "matches": results, "count": len(results)},
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Ensure search stays inside approved workspace roots"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"File search failed: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
