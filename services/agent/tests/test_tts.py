import io
import wave
import pytest
from unittest.mock import MagicMock, patch
from aura_agent.services.tts import (
    PiperTTSService,
    TTSError,
    TTSInvalidTextError,
    TTSModelNotFoundError,
)


def test_piper_missing_model_raises_not_found():
    """Verify that a nonexistent voice model path raises TTSModelNotFoundError."""
    tts = PiperTTSService(model_path="/tmp/nonexistent_voice.onnx")
    assert tts.is_available() is False

    with pytest.raises(TTSModelNotFoundError) as exc_info:
        tts._load_voice()
    assert "Piper voice model was not found" in str(exc_info.value)
    assert "setup_voice" in str(exc_info.value)


@pytest.mark.asyncio
async def test_piper_empty_text_raises_invalid_text():
    """Verify that empty or whitespace text raises TTSInvalidTextError."""
    tts = PiperTTSService(model_path="/tmp/fake.onnx")
    with pytest.raises(TTSInvalidTextError):
        await tts.synthesize("   ")


@pytest.mark.asyncio
async def test_piper_synthesize_mocked_success():
    """Verify speech synthesis flow with a mocked PiperVoice."""
    tts = PiperTTSService(model_path="/tmp/fake.onnx")

    def mock_synthesize_wav(text, wav_file):
        wav_file.setframerate(22050)
        wav_file.setsampwidth(2)
        wav_file.setnchannels(1)
        wav_file.writeframes(b"\x00\x00" * 1000)

    mock_voice = MagicMock()
    mock_voice.synthesize_wav.side_effect = mock_synthesize_wav

    with patch.object(tts, "_load_voice", return_value=mock_voice):
        wav_bytes = await tts.synthesize("Hello world")

        assert len(wav_bytes) > 44  # Valid WAV header + frames
        assert wav_bytes.startswith(b"RIFF")
        assert b"WAVE" in wav_bytes

        # Verify it can be parsed as valid WAV
        buf = io.BytesIO(wav_bytes)
        with wave.open(buf, "rb") as w:
            assert w.getframerate() == 22050
            assert w.getnchannels() == 1
            assert w.getnframes() == 1000


def test_tts_get_status():
    """Verify TTS status reporting."""
    tts = PiperTTSService(model_path="/tmp/fake.onnx")
    status = tts.get_status()
    assert status["engine"] == "piper-tts"
    assert status["model_path"] == "/tmp/fake.onnx"
    assert "available" in status
