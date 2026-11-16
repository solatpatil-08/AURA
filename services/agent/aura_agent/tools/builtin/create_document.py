import os
import pathlib
from typing import Optional, Set
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import PathJail, SecurityViolationError


class CreateDocumentArgs(BaseModel):
    relative_path: str = Field(
        ...,
        min_length=1,
        max_length=250,
        description="Path of the text document to create, relative to approved workspace root (e.g. 'AURA_QA/test-report.txt').",
    )
    content: str = Field(
        ...,
        max_length=100000,
        description="Text content to write inside the document.",
    )


class CreateDocumentTool(BaseTool):
    """Tool to safely create and write text documents inside an approved workspace."""

    name = "create_document"
    description = "Safely create or write a plain text or markdown document (.txt, .md, .json, .csv) inside the approved workspace."
    risk_tier = RiskTier.TIER_2_MONITORED_WRITE
    args_schema = CreateDocumentArgs

    ALLOWED_EXTENSIONS: Set[str] = {
        ".txt",
        ".md",
        ".json",
        ".csv",
        ".log",
        ".yaml",
        ".yml",
        ".xml",
        ".html",
    }

    PROHIBITED_EXTENSIONS: Set[str] = {
        ".exe",
        ".bat",
        ".cmd",
        ".ps1",
        ".sh",
        ".vbs",
        ".dll",
        ".bin",
        ".py",
        ".msi",
        ".com",
        ".scr",
        ".jar",
    }

    def __init__(self, path_jail: PathJail):
        self.path_jail = path_jail

    async def execute(self, args: CreateDocumentArgs, context: ExecutionContext) -> ToolResult:
        try:
            # 1. Validate destination path within workspace
            target_path = self.path_jail.validate_path(args.relative_path, must_exist=False)

            # 2. Strict extension validation
            ext = target_path.suffix.lower()
            if not ext:
                ext = ".txt"
                target_path = target_path.with_suffix(".txt")

            if ext in self.PROHIBITED_EXTENSIONS:
                raise SecurityViolationError(
                    f"Creating executable or script file with extension '{ext}' is strictly prohibited."
                )

            if ext not in self.ALLOWED_EXTENSIONS:
                raise SecurityViolationError(
                    f"File extension '{ext}' is not permitted for document creation. "
                    f"Allowed extensions: {sorted(self.ALLOWED_EXTENSIONS)}"
                )

            # 3. Check for existing file & overwrite protection
            file_exists = target_path.exists()
            if file_exists:
                if target_path.is_dir():
                    return ToolResult(
                        success=False,
                        summary=f"Path '{args.relative_path}' already exists as a directory.",
                        error=f"A directory already exists at {target_path}",
                        recovery_options=["Choose a different document name or path"],
                        risk_tier=self.risk_tier,
                    )
                if not context.user_confirmed and context.policy in ("request-review", "strict"):
                    return ToolResult(
                        success=False,
                        summary=f"Document '{target_path.name}' already exists. Overwrite requires confirmation.",
                        error=f"File '{args.relative_path}' already exists in workspace.",
                        recovery_options=["Provide user confirmation to overwrite", "Choose a different file name"],
                        risk_tier=self.risk_tier,
                    )

            # 4. Ensure parent directory exists
            target_path.parent.mkdir(parents=True, exist_ok=True)

            # 5. Write content safely with UTF-8 encoding
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(args.content)

            size_bytes = target_path.stat().st_size
            primary_workspace = self.path_jail.allowed_workspaces[0]
            rel_display = (
                str(target_path.relative_to(primary_workspace))
                if primary_workspace in target_path.parents or target_path == primary_workspace
                else target_path.name
            )

            summary = f"Document '{rel_display}' successfully created ({size_bytes} bytes)."
            return ToolResult(
                success=True,
                data={
                    "path": rel_display,
                    "filename": target_path.name,
                    "size_bytes": size_bytes,
                    "overwritten": file_exists,
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Only create safe documents inside approved workspace roots"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to create document '{args.relative_path}': {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )

