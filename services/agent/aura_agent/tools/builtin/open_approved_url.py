import webbrowser
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import URLValidator, SecurityViolationError


class OpenUrlArgs(BaseModel):
    url: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="The web address (HTTP or HTTPS) to open in the system default browser.",
    )


class OpenApprovedUrlTool(BaseTool):
    """Tool to open user-approved web URLs in the default browser."""

    name = "open_approved_url"
    description = "Open a user-approved website URL using the default web browser."
    risk_tier = RiskTier.TIER_3_SYSTEM_EXTERNAL
    args_schema = OpenUrlArgs

    async def execute(self, args: OpenUrlArgs, context: ExecutionContext) -> ToolResult:
        try:
            # Policy check: Tier 3 requires confirmation unless explicitly confirmed
            if not context.user_confirmed and context.policy in ("request-review", "strict"):
                return ToolResult(
                    success=False,
                    summary=f"Opening external URL '{args.url}' requires user approval.",
                    error=f"Confirmation required for opening web URL '{args.url}'.",
                    recovery_options=["Ask user to approve opening the URL", "Cancel opening website"],
                    risk_tier=self.risk_tier,
                )

            validated_url = URLValidator.validate_url(args.url)

            # Open in default browser
            opened = webbrowser.open(validated_url)

            summary = f"Opened website '{validated_url}' in default browser."
            return ToolResult(
                success=True,
                data={"url": validated_url, "opened": opened},
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Only supply HTTP or HTTPS URLs"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to open URL '{args.url}': {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
