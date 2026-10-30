from fastapi import APIRouter, Depends, Request
from aura_agent.config import settings
from aura_agent.models.schemas import SystemStatusResponse, OllamaStatus, VoiceStatusResponse
from aura_agent.services.ollama import OllamaClient, OllamaError
from aura_agent.services.stt import BaseSTTService
from aura_agent.services.tts import BaseTTSService

router = APIRouter(prefix="/api/system", tags=["System"])


def get_ollama_client(request: Request) -> OllamaClient:
    return request.app.state.ollama_client


@router.get("/status", response_model=SystemStatusResponse)
async def get_system_status(
    request: Request,
    ollama_client: OllamaClient = Depends(get_ollama_client),
) -> SystemStatusResponse:
    """Detailed system status inspecting local Ollama, STT, and TTS engines."""
    connected = False
    available_models = []
    model_installed = False
    error_message = None

    try:
        available_models = await ollama_client.get_tags()
        connected = True
        model_installed = await ollama_client.is_model_installed(settings.model_name)
        if not model_installed:
            error_message = (
                f"Model '{settings.model_name}' is not installed in local Ollama. "
                f"Run: 'ollama run {settings.model_name}'"
            )
    except OllamaError as exc:
        error_message = str(exc)
    except Exception as exc:
        error_message = f"Unexpected connectivity failure: {exc}"

    ollama_status = OllamaStatus(
        connected=connected,
        base_url=settings.ollama_base_url,
        available_models=available_models,
        model_installed=model_installed,
        active_model=settings.model_name,
        error_message=error_message,
    )

    stt_service: BaseSTTService = getattr(request.app.state, "stt_service", None)
    tts_service: BaseTTSService = getattr(request.app.state, "tts_service", None)

    voice_status = None
    if stt_service and tts_service:
        voice_status = VoiceStatusResponse(
            enabled=settings.voice_enabled,
            stt=stt_service.get_status(),
            tts=tts_service.get_status(),
        )

    return SystemStatusResponse(
        backend_status="ready",
        ollama=ollama_status,
        voice=voice_status,
        database="sqlite+aiosqlite (connected)",
        host=settings.host,
        port=settings.port,
    )
