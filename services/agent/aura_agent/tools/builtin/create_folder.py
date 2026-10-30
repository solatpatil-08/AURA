import pathlib
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import PathJail, SecurityViolationError


class CreateFolderArgs(BaseModel):
    relative_path: str = Field(
        ...,
        min_length=1,
        description="Path of the directory to create, relative to approved workspace root.",
    )


class CreateFolderTool(BaseTool):
    """Tool to create directories inside an approved workspace."""

    name = "create_folder"
    description = "Create a directory inside the approved workspace."
    risk_tier = RiskTier.TIER_2_MONITORED_WRITE
    args_schema = CreateFolderArgs

    def __init__(self, path_jail: PathJail):
        self.path_jail = path_jail

    async def execute(self, args: CreateFolderArgs, context: ExecutionContext) -> ToolResult:
        try:
            target_path = self.path_jail.validate_path(args.relative_path, must_exist=False)

            if target_path.exists():
                if target_path.is_dir():
                    summary = f"Directory '{args.relative_path}' already exists."
                    return ToolResult(
                        success=True,
                        data={"path": args.relative_path, "already_existed": True},
                        summary=summary,
                        risk_tier=self.risk_tier,
                    )
                else:
                    return ToolResult(
                        success=False,
                        summary=f"Path '{args.relative_path}' already exists and is a file.",
                        error=f"A non-directory file already exists at {target_path}",
                        recovery_options=["Choose a different folder name"],
                        risk_tier=self.risk_tier,
                    )

            target_path.mkdir(parents=True, exist_ok=True)
            primary_workspace = self.path_jail.allowed_workspaces[0]
            rel_display = str(target_path.relative_to(primary_workspace)) if primary_workspace in target_path.parents or target_path == primary_workspace else target_path.name

            summary = f"Directory '{rel_display}' successfully created."
            return ToolResult(
                success=True,
                data={"path": rel_display, "already_existed": False},
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Create folders only inside approved workspace roots"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to create folder: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
