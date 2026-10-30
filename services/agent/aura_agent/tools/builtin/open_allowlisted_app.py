import subprocess
from typing import List, Optional
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import ApplicationAllowlist, SecurityViolationError


class OpenAppArgs(BaseModel):
    app_name: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Name of the allowlisted application (e.g. 'notepad', 'calc', 'code', 'explorer').",
    )
    args: Optional[List[str]] = Field(
        default=None,
        description="Optional command-line arguments to pass to the allowlisted application.",
    )


class OpenAllowlistedAppTool(BaseTool):
    """Tool to launch pre-approved desktop applications safely without shell interpretation."""

    name = "open_allowlisted_app"
    description = "Launch an application from the configured application allowlist without shell access."
    risk_tier = RiskTier.TIER_3_SYSTEM_EXTERNAL
    args_schema = OpenAppArgs

    def __init__(self, allowlist: ApplicationAllowlist):
        self.allowlist = allowlist

    async def execute(self, args: OpenAppArgs, context: ExecutionContext) -> ToolResult:
        try:
            # Policy check: Tier 3 requires confirmation unless explicitly confirmed
            if not context.user_confirmed and context.policy in ("request-review", "strict"):
                return ToolResult(
                    success=False,
                    summary=f"Launching application '{args.app_name}' requires explicit user confirmation.",
                    error=f"Confirmation required for launching external application '{args.app_name}'.",
                    recovery_options=["Request user approval before launching application", "Cancel application launch"],
                    risk_tier=self.risk_tier,
                )

            executable, clean_args = self.allowlist.validate_app_execution(args.app_name, args.args)

            cmd = [executable] + clean_args

            # Launch process with shell=False strictly
            proc = subprocess.Popen(
                cmd,
                shell=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            summary = f"Application '{args.app_name}' launched successfully (PID: {proc.pid})."
            return ToolResult(
                success=True,
                data={
                    "app_name": args.app_name,
                    "executable": executable,
                    "pid": proc.pid,
                    "args": clean_args,
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Only request applications registered in AURA's allowlist"],
                risk_tier=self.risk_tier,
            )
        except FileNotFoundError as fnf_err:
            return ToolResult(
                success=False,
                summary=f"Application executable not found: {args.app_name}",
                error=str(fnf_err),
                recovery_options=["Verify that the application is installed on this workstation"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to launch application '{args.app_name}': {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
