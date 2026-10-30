from pydantic import BaseModel, Field
from aura_agent.services.browser import BrowserService, AccessRestrictedError, NavigationTimeoutError
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult
from aura_agent.tools.security import SecurityViolationError


class ReadWebPageArgs(BaseModel):
    url: str = Field(
        ...,
        min_length=5,
        max_length=2000,
        description="The HTTP or HTTPS web page address to navigate to and read.",
    )


class ReadWebPageTool(BaseTool):
    """Tool to navigate to an approved web page and extract clean, readable text content safely."""

    name = "read_web_page"
    description = "Navigate to an approved web page URL and extract its readable text content with indirect prompt injection defenses."
    risk_tier = RiskTier.TIER_3_SYSTEM_EXTERNAL
    args_schema = ReadWebPageArgs

    def __init__(self, browser_service: BrowserService):
        self.browser_service = browser_service

    async def execute(self, args: ReadWebPageArgs, context: ExecutionContext) -> ToolResult:
        try:
            # Policy check: Tier 3 requires confirmation unless confirmed
            if not context.user_confirmed and context.policy in ("request-review", "strict"):
                return ToolResult(
                    success=False,
                    summary=f"Navigating to external web page '{args.url}' requires user approval.",
                    error=f"Confirmation required to read external page '{args.url}'.",
                    recovery_options=["Approve navigation to this URL", "Cancel web page inspection"],
                    risk_tier=self.risk_tier,
                )

            page_content = await self.browser_service.fetch_page(args.url)
            fenced_content = self.browser_service.wrap_untrusted_content(page_content)

            summary = f"Read '{page_content.title}' from '{page_content.url}' ({page_content.word_count} words)."
            if page_content.truncated:
                summary += " [Truncated for token budget]."

            return ToolResult(
                success=True,
                data={
                    "url": page_content.url,
                    "title": page_content.title,
                    "content": fenced_content,
                    "word_count": page_content.word_count,
                    "truncated": page_content.truncated,
                },
                summary=summary,
                risk_tier=self.risk_tier,
            )

        except SecurityViolationError as sec_err:
            return ToolResult(
                success=False,
                summary=f"Security violation: {sec_err}",
                error=str(sec_err),
                recovery_options=["Only request HTTP or HTTPS URLs", "Check domain allowlist configuration"],
                risk_tier=self.risk_tier,
            )
        except AccessRestrictedError as res_err:
            return ToolResult(
                success=False,
                summary=f"Access restricted: {res_err}",
                error=str(res_err),
                recovery_options=["Website requires human verification (CAPTCHA) or blocks automated retrieval"],
                risk_tier=self.risk_tier,
            )
        except NavigationTimeoutError as time_err:
            return ToolResult(
                success=False,
                summary=f"Navigation timeout: {time_err}",
                error=str(time_err),
                recovery_options=["Verify URL is reachable", "Try again later"],
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to read web page '{args.url}': {exc}",
                error=str(exc),
                recovery_options=["Verify URL syntax", "Check website availability"],
                risk_tier=self.risk_tier,
            )
