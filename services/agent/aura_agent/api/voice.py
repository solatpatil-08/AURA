import logging
from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile, status
from aura_agent.config import settings
from aura_agent.models.schemas import SynthesizeRequest, TranscribeResponse, VoiceStatusResponse
from aura_agent.services.stt import (
    BaseSTTService,
    STTError,
    STTInvalidAudioError,
    STTModelNotFoundError,
)
from aura_agent.services.tts import (
    BaseTTSService,
    TTSError,
    TTSInvalidTextError,
    TTSModelNotFoundError,
)

logger = logging.getLogger("aura.api.voice")
router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.get("/status", response_model=VoiceStatusResponse)
async def get_voice_status(request: Request) -> VoiceStatusResponse:
    """Return availability and diagnostic information for local STT and TTS engines."""
    stt_service: BaseSTTService = getattr(request.app.state, "stt_service", None)
    tts_service: BaseTTSService = getattr(request.app.state, "tts_service", None)

    stt_status = stt_service.get_status() if stt_service else {"available": False, "error": "STT service not registered"}
    tts_status = tts_service.get_status() if tts_service else {"available": False, "error": "TTS service not registered"}

    return VoiceStatusResponse(
        enabled=settings.voice_enabled,
        stt=stt_status,
        tts=tts_status,
    )


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(..., description="Audio recording file (WAV, WebM, OGG)"),
) -> TranscribeResponse:
    """Transcribe user-recorded speech audio locally using faster-whisper.

    Guarantees:
    - Local processing with zero external cloud API calls.
    - Temporary memory buffering; recordings are not saved to disk unless requested.
    """
    stt_service: BaseSTTService = getattr(request.app.state, "stt_service", None)
    if not stt_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Speech-to-text service is not initialized on this backend.",
        )

    # Read uploaded audio content into memory
    try:
        audio_bytes = await file.read()
    except Exception as e:
        logger.error("Failed to read uploaded audio stream: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read uploaded audio stream.",
        ) from e

    # Request size guard
    if len(audio_bytes) > settings.max_audio_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Audio payload ({len(audio_bytes)} bytes) exceeds the maximum allowed limit ({settings.max_audio_upload_bytes} bytes).",
        )

    if not audio_bytes or len(audio_bytes) < 100:
        return TranscribeResponse(text="", language=settings.stt_language)

    try:
        transcript = await stt_service.transcribe(audio_bytes, filename=file.filename or "recording.wav")
        return TranscribeResponse(text=transcript, language=settings.stt_language)
    except STTModelNotFoundError as e:
        logger.warning("STT Model missing: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    except STTInvalidAudioError as e:
        logger.warning("Invalid audio format: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except STTError as e:
        logger.error("STT transcription error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Speech transcription failed: {e}",
        ) from e


@router.post("/synthesize")
async def synthesize_speech(
    request: Request,
    body: SynthesizeRequest,
) -> Response:
    """Synthesize text into speech audio locally using Piper TTS.

    Guarantees:
    - Generated on-device with zero cloud AI dependencies.
    - Returns standard audio/wav binary stream ready for desktop playback.
    """
    tts_service: BaseTTSService = getattr(request.app.state, "tts_service", None)
    if not tts_service:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Text-to-speech service is not initialized on this backend.",
        )

    try:
        wav_bytes = await tts_service.synthesize(body.text)
        return Response(
            content=wav_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "inline; filename=aura_speech.wav",
                "Cache-Control": "no-cache",
            },
        )
    except TTSModelNotFoundError as e:
        logger.warning("TTS Model missing: %s", e)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        ) from e
    except TTSInvalidTextError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except TTSError as e:
        logger.error("TTS synthesis error: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Speech synthesis failed: {e}",
        ) from e
