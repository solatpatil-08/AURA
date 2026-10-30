import io
import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, MagicMock
from aura_agent.main import app
from aura_agent.services.stt import (
    BaseSTTService,
    STTInvalidAudioError,
    STTModelNotFoundError,
)
from aura_agent.services.tts import (
    BaseTTSService,
    TTSModelNotFoundError,
)


@pytest.fixture
def mock_stt_service():
    service = MagicMock(spec=BaseSTTService)
    service.is_available.return_value = True
    service.get_status.return_value = {
        "engine": "faster-whisper",
        "available": True,
        "model": "base.en",
        "device": "cpu",
        "error": None,
    }
    service.transcribe = AsyncMock(return_value="What is the active project architecture?")
    return service


@pytest.fixture
def mock_tts_service():
    service = MagicMock(spec=BaseTTSService)
    service.is_available.return_value = True
    service.get_status.return_value = {
        "engine": "piper-tts",
        "available": True,
        "model_path": "models/piper/en_US-lessac-medium.onnx",
        "error": None,
    }
    # Return valid dummy WAV bytes
    fake_wav = b"RIFF$" + b"\x00" * 36 + b"WAVEfmt " + b"\x00" * 20 + b"data" + b"\x00" * 200
    service.synthesize = AsyncMock(return_value=fake_wav)
    return service


@pytest.mark.asyncio
async def test_get_voice_status_endpoint(mock_stt_service, mock_tts_service):
    """Verify GET /api/voice/status returns engine diagnostic payload."""
    app.state.stt_service = mock_stt_service
    app.state.tts_service = mock_tts_service

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.get("/api/voice/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is True
        assert data["stt"]["engine"] == "faster-whisper"
        assert data["tts"]["engine"] == "piper-tts"


@pytest.mark.asyncio
async def test_transcribe_endpoint_success(mock_stt_service):
    """Verify POST /api/voice/transcribe successfully processes uploaded audio."""
    app.state.stt_service = mock_stt_service

    dummy_audio_bytes = b"RIFF" + b"\x00" * 256
    files = {"file": ("recording.wav", io.BytesIO(dummy_audio_bytes), "audio/wav")}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.post("/api/voice/transcribe", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["text"] == "What is the active project architecture?"
        assert data["language"] == "en"
        mock_stt_service.transcribe.assert_called_once()


@pytest.mark.asyncio
async def test_transcribe_missing_model_error():
    """Verify POST /api/voice/transcribe returns 503 when the Whisper model is missing."""
    failing_stt = MagicMock(spec=BaseSTTService)
    failing_stt.transcribe = AsyncMock(
        side_effect=STTModelNotFoundError("Whisper model 'base.en' was not found locally.")
    )
    app.state.stt_service = failing_stt

    files = {"file": ("recording.wav", io.BytesIO(b"RIFF" + b"\x00" * 200), "audio/wav")}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.post("/api/voice/transcribe", files=files)
        assert resp.status_code == 503
        assert "was not found locally" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_transcribe_corrupt_audio_error():
    """Verify POST /api/voice/transcribe returns 400 for corrupt audio format."""
    failing_stt = MagicMock(spec=BaseSTTService)
    failing_stt.transcribe = AsyncMock(
        side_effect=STTInvalidAudioError("Corrupt audio stream could not be parsed.")
    )
    app.state.stt_service = failing_stt

    files = {"file": ("corrupt.wav", io.BytesIO(b"RIFF" + b"\x00" * 200), "audio/wav")}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.post("/api/voice/transcribe", files=files)
        assert resp.status_code == 400
        assert "Corrupt audio stream" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_synthesize_endpoint_success(mock_tts_service):
    """Verify POST /api/voice/synthesize returns WAV audio stream."""
    app.state.tts_service = mock_tts_service

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.post(
            "/api/voice/synthesize",
            json={"text": "Hello user, AURA is ready."},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/wav"
        assert len(resp.content) > 0
        mock_tts_service.synthesize.assert_called_once_with("Hello user, AURA is ready.")


@pytest.mark.asyncio
async def test_synthesize_missing_voice_error():
    """Verify POST /api/voice/synthesize returns 503 when the Piper model is missing."""
    failing_tts = MagicMock(spec=BaseTTSService)
    failing_tts.synthesize = AsyncMock(
        side_effect=TTSModelNotFoundError("Piper voice model file not found.")
    )
    app.state.tts_service = failing_tts

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.post(
            "/api/voice/synthesize",
            json={"text": "Hello user"},
        )
        assert resp.status_code == 503
        assert "not found" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_system_status_includes_voice(mock_stt_service, mock_tts_service):
    """Verify GET /api/system/status response includes voice subsystem status."""
    app.state.stt_service = mock_stt_service
    app.state.tts_service = mock_tts_service

    # Mock Ollama client on app.state
    mock_ollama = MagicMock()
    mock_ollama.get_tags = AsyncMock(return_value=["qwen3.5:4b"])
    mock_ollama.is_model_installed = AsyncMock(return_value=True)
    app.state.ollama_client = mock_ollama

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
        resp = await client.get("/api/system/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "voice" in data
        assert data["voice"]["stt"]["engine"] == "faster-whisper"
        assert data["voice"]["tts"]["engine"] == "piper-tts"
