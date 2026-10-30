from datetime import datetime, timezone
import zoneinfo
from typing import Optional
from pydantic import BaseModel, Field
from aura_agent.tools.base import BaseTool, ExecutionContext, RiskTier, ToolResult


class GetCurrentTimeArgs(BaseModel):
    timezone_name: Optional[str] = Field(
        default=None,
        description="Optional IANA timezone name (e.g. 'America/New_York', 'UTC', 'Asia/Kolkata'). Defaults to local machine time.",
    )


class GetCurrentTimeTool(BaseTool):
    """Tool to get the current local time, date, weekday, and timezone information."""

    name = "get_current_time"
    description = "Get the current local date, time, weekday, and timezone details on this computer."
    risk_tier = RiskTier.TIER_1_READ_ONLY
    args_schema = GetCurrentTimeArgs

    async def execute(self, args: GetCurrentTimeArgs, context: ExecutionContext) -> ToolResult:
        try:
            if args.timezone_name:
                tz_clean = args.timezone_name.strip().upper()
                if tz_clean in ("UTC", "Z", "GMT"):
                    now = datetime.now(timezone.utc)
                else:
                    try:
                        tz = zoneinfo.ZoneInfo(args.timezone_name)
                        now = datetime.now(tz)
                    except Exception:
                        return ToolResult(
                            success=False,
                            summary=f"Invalid or unrecognized timezone name: '{args.timezone_name}'",
                            error=f"Timezone '{args.timezone_name}' is not recognized.",
                            recovery_options=["Use a valid IANA timezone (e.g. 'UTC', 'America/New_York')", "Omit timezone_name to get local system time"],
                            risk_tier=self.risk_tier,
                        )
            else:
                now = datetime.now().astimezone()

            data = {
                "iso": now.isoformat(),
                "time": now.strftime("%H:%M:%S"),
                "date": now.strftime("%Y-%m-%d"),
                "weekday": now.strftime("%A"),
                "timezone": str(now.tzinfo),
                "utc_offset": now.strftime("%z"),
            }

            summary = f"Current local time is {data['time']} on {data['weekday']}, {data['date']} ({data['timezone']})."
            return ToolResult(
                success=True,
                data=data,
                summary=summary,
                risk_tier=self.risk_tier,
            )
        except Exception as exc:
            return ToolResult(
                success=False,
                summary=f"Failed to retrieve current time: {exc}",
                error=str(exc),
                risk_tier=self.risk_tier,
            )
