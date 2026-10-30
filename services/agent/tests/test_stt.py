import io
import pytest
from unittest.mock import MagicMock, patch
from aura_agent.services.stt import (
    FasterWhisperSTT,
    STTError,
    STTInvalidAudioError,
    STTModelNotFoundError,
)


def test_faster_whisper_missing_model_raises_not_found():
    """Verify that attempting to load a missing model with local_files_only raises STTModelNotFoundError."""
    stt = FasterWhisperSTT(
        model_size_or_path="nonexistent_whisper_model_999",
        model_dir="/tmp/nonexistent_dir",
    )
    assert stt.is_available() is False

    with pytest.raises(STTModelNotFoundError) as exc_info:
        stt._load_model()
    assert "was not found locally" in str(exc_info.value)
    assert "setup_voice" in str(exc_info.value)


@pytest.mark.asyncio
async def test_faster_whisper_transcribe_mocked_success():
    """Verify transcription flow using a mocked WhisperModel instance."""
    stt = FasterWhisperSTT(model_size_or_path="base.en")

    mock_segment = MagicMock()
    mock_segment.text = "Hello AURA, summarize my tasks."
    mock_info = MagicMock()
    mock_info.language = "en"
    mock_info.duration = 2.5

    mock_whisper_instance = MagicMock()
    mock_whisper_instance.transcribe.return_value = ([mock_segment], mock_info)

    with patch.object(stt, "_load_model", return_value=mock_whisper_instance):
        dummy_audio = b"RIFF" + b"\x00" * 500  # Fake valid audio buffer
        transcript = await stt.transcribe(dummy_audio)

        assert transcript == "Hello AURA, summarize my tasks."
        mock_whisper_instance.transcribe.assert_called_once()


@pytest.mark.asyncio
async def test_faster_whisper_empty_audio_returns_empty_string():
    """Verify that empty or tiny audio bytes return an empty string without invoking the model."""
    stt = FasterWhisperSTT(model_size_or_path="base.en")
    result = await stt.transcribe(b"")
    assert result == ""

    result_tiny = await stt.transcribe(b"too_short")
    assert result_tiny == ""


def test_stt_get_status():
    """Verify diagnostic status format."""
    stt = FasterWhisperSTT(model_size_or_path="base.en", device="cpu", compute_type="int8")
    status = stt.get_status()
    assert status["engine"] == "faster-whisper"
    assert status["model"] == "base.en"
    assert status["device"] == "cpu"
    assert status["compute_type"] == "int8"
    assert "available" in status
