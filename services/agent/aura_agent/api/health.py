from fastapi import APIRouter
from aura_agent.models.schemas import HealthResponse

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Service readiness and liveness probe."""
    return HealthResponse(status="ok")
