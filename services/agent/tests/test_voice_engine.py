import io
import wave
import pytest
from aura_agent.services.tts import PiperTTSService, clean_text_for_speech
from aura_agent.services.stt import FasterWhisperSTT


def test_clean_text_for_speech_strips_thinking_blocks():
    """Verify that model reasoning / <think> tags are completely removed."""
    raw = (
        "<think>\n"
        "The user is asking for the project status.\n"
        "I need to check the database and confirm.\n"
        "</think>\n"
        "AURA is currently operational and ready for instructions."
    )
    cleaned = clean_text_for_speech(raw)
    assert "<think>" not in cleaned
    assert "The user is asking" not in cleaned
    assert cleaned == "AURA is currently operational and ready for instructions."


def test_clean_text_for_speech_strips_code_and_tool_json():
    """Verify code blocks, inline backticks, and tool call JSON are stripped."""
    raw = (
        "Here is the command you requested:\n"
        "```bash\n"
        "npm run build\n"
        "```\n"
        '{"tool_name": "run_command", "parameters": {"cmd": "dir"}}\n'
        "Use `npm start` to launch."
    )
    cleaned = clean_text_for_speech(raw)
    assert "npm run build" not in cleaned
    assert "tool_name" not in cleaned
    assert cleaned == "Here is the command you requested: Use npm start to launch."


def test_clean_text_for_speech_formats_links_and_headings():
    """Verify markdown links keep link text and headings are flattened."""
    raw = (
        "# System Overview\n"
        "- Item 1: Review docs at [AURA Docs](https://github.com/solatpatil-08/AURA).\n"
        "- Item 2: Ready."
    )
    cleaned = clean_text_for_speech(raw)
    assert "https://" not in cleaned
    assert "AURA Docs" in cleaned
    assert "#" not in cleaned
    assert cleaned == "System Overview Item 1: Review docs at AURA Docs. Item 2: Ready."


def test_clean_text_empty_input():
    """Verify empty or whitespace-only inputs."""
    assert clean_text_for_speech("") == ""
    assert clean_text_for_speech("   \n\t  ") == ""
    assert clean_text_for_speech("<think>only thoughts</think>") == ""


def test_whisper_hardware_acceleration_detection():
    """Verify default compute selection is CPU INT8."""
    device, compute = FasterWhisperSTT._determine_hardware_acceleration("cpu", "int8")
    assert device == "cpu"
    assert compute == "int8"


@pytest.mark.asyncio
async def test_end_to_end_local_voice_loop():
    """Verify actual local synthesis with Piper and transcription with faster-whisper."""
    tts = PiperTTSService()
    stt = FasterWhisperSTT(model_size_or_path="base")

    if not tts.is_available() or not stt.is_available():
        pytest.skip("Local voice models not installed in environment.")

    # 1. Synthesize audio with Piper
    test_phrase = "Autonomous utility reasoning and automation."
    wav_bytes = await tts.synthesize(test_phrase)
    assert len(wav_bytes) > 1000
    assert wav_bytes.startswith(b"RIFF")

    # 2. Transcribe synthesized audio back with Whisper
    transcript, lang, duration = await stt.transcribe_with_metadata(wav_bytes)
    assert transcript is not None
    assert len(transcript) > 0
    # Whisper should recognize the keywords
    normalized = transcript.lower()
    assert "autonomous" in normalized or "automation" in normalized or "reasoning" in normalized
    assert duration > 0.5
