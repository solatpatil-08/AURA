import os
import pathlib
import re
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import PathJail, SecurityViolationError


class CreateNoteArgs(BaseModel):
    title: str = Field(
        ...,
        min_length=1,
        max_length=150,
        description="Title of the note (used to generate filename).",
    )
    content: str = Field(
        ...,
        min_length=1,
        max_length=100000,
        description="Markdown content to write inside the note.",
    )
    folder: Optional[str] = Field(
        default=None,
        description="Optional subfolder inside AURA's designated notes directory.",
    )


class CreateNoteTool(BaseTool):
    """Tool to create markdown notes inside AURA's designated notes directory."""

    name = "create_note"
    description = "Create a markdown note inside AURA's designated notes directory."
    risk_tier = RiskTier.TIER_2_MONITORED_WRITE
    args_schema = CreateNoteArgs

    def __init__(self, path_jail: PathJail, notes_dir: pathlib.Path):
        self.path_jail = path_jail
        self.notes_dir = notes_dir.resolve()

    def _sanitize_title(self, title: str) -> str:
        # Replace non-alphanumeric characters with hyphens
        clean = re.sub(r"[^\w\s-]", "", title).strip()
        clean = re.sub(r"[-\s]+", "-", clean)
        return clean or "untitled_note"

    async def execute(self, args: CreateNoteArgs, context: ExecutionContext) -> ToolResult:
        try:
            # Ensure target folder is jailed within notes_dir
            if args.folder:
                # Disallow traversal segments
                if ".." in args.folder:
                    raise SecurityViolationError("Path traversal ('..') is prohibited in notes subfolder.")
                target_folder = (self.notes_dir / args.folder).resolve()
            else:
                target_folder = self.notes_dir

            # Verify containment in notes_dir
            if not (target_folder == self.notes_dir or self.notes_dir in target_folder.parents):
                raise SecurityViolationError(f"Target folder '{target_folder}' escapes designated notes directory.")

            # Create folder if needed
            target_folder.mkdir(parents=True, exist_ok=True)

            filename = f"{self._sanitize_title(args.title)}.md"
            target_file = (target_folder / filename).resolve()

            # Verify target file containment
            if not (target_file == self.notes_dir or self.notes_dir in target_file.parents):
                raise SecurityViolationError("Note path escapes notes directory.")

            # Check if file already exists
            file_exists = target_file.exists()
            if file_exists and not context.user_confirmed and context.policy == "request-review":
                return ToolResult(
                    success=False,
                    summary=f"Note '{filename}' already exists. Overwrite requires confirmation.",
                    error=f"File '{filename}' already exists in notes directory.",
                    recovery_options=["Provide user confirmation to overwrite", "Choose a different title"],
                    risk_tier=self.risk_tier,
                )

            # Write note content
            header = f"# {args.title}\n\n*Created on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')} by AURA*\n\n"
            full_content = header + args.content

            with open(target_file, "w", encoding="utf-8") as f:
                f.write(full_content)

            size = target_file.stat().st_size
            primary_workspace = self.path_jail.allowed_workspaces[0]
            rel_display = str(target_file.relative_to(primary_workspace)) if primary_workspace in target_file.parents else target_file.name

            summary = f"Note '{args.title}' successfully written to '{rel_display}' ({size} bytes)."
            return ToolResult(
                success=True,
                data={
                    "title": args.title,
                    "filename": filename,
                    "path": rel_display,
                    "size_bytes": size,
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
                recovery_options=["Store notes strictly inside AURA's notes directory"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to create note: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
