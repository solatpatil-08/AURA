import glob
import io
import json
import logging
import os
import re
import wave
import asyncio
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("aura.voice.tts")


def clean_text_for_speech(text: str) -> str:
    """Sanitize AI response text for natural spoken audio output.

    Guarantees:
    - Never speaks internal thinking/reasoning blocks (<think>...</think>).
    - Never speaks raw JSON, tool calls, or code blocks.
    - Strips URLs, markdown formatting, emojis, and noisy symbols.
    - Produces clean conversational speech.
    """
    if not text:
        return ""

    # 1. Strip <think>...</think> and <reasoning>...</reasoning> blocks
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"<reasoning>[\s\S]*?</reasoning>", "", cleaned, flags=re.IGNORECASE)

    # 2. Strip markdown code fences (e.g. ```python ... ```)
    cleaned = re.sub(r"```[\s\S]*?```", "", cleaned)

    # 3. Convert markdown links [text](url) -> text
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)

    # 4. Remove raw URLs
    cleaned = re.sub(r"https?://\S+", "", cleaned)

    # 5. Strip JSON objects/arrays (including nested JSON structures)
    for _ in range(6):
        cleaned = re.sub(r"\{[^{}]*\}", "", cleaned)

    # 6. Strip inline code backticks while keeping inner text (`npm start` -> npm start)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = re.sub(r"`+", "", cleaned)

    # 7. Strip markdown header markers, bullet points, blockquotes
    cleaned = re.sub(r"^[ \t]*[#*+->]+[ \t]*", "", cleaned, flags=re.MULTILINE)

    # 8. Strip emphasis markers (*, _, ~, #)
    cleaned = re.sub(r"[*_~#]", "", cleaned)

    # 9. Clean up multiple punctuation or unusual characters
    cleaned = re.sub(r"[|\^\\<>]", "", cleaned)

    # 10. Normalize whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


class TTSError(Exception):
    """Base exception for Text-to-Speech operations."""
    pass


class TTSModelNotFoundError(TTSError):
    """Raised when the specified Piper voice model files are not found locally."""
    pass


class TTSInvalidTextError(TTSError):
    """Raised when text provided for synthesis is invalid or empty."""
    pass


class BaseTTSService(ABC):
    """Replaceable interface for local Text-to-Speech synthesis."""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if TTS engine and local voice files are available."""
        pass

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        """Return engine diagnostic status."""
        pass

    @abstractmethod
    def list_available_voices(self) -> List[Dict[str, Any]]:
        """List all discovered local Piper voice models."""
        pass

    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        """Synthesize text to local WAV audio bytes asynchronously."""
        pass


class PiperTTSService(BaseTTSService):
    """Local Text-to-Speech adapter using Piper TTS (ONNX Runtime).

    Guarantees:
    - 100% on-device local execution using ONNX.
    - Zero external cloud TTS APIs or telemetry.
    - Sanitizes text to prevent speaking reasoning, code blocks, or tool JSON.
    - Clean WAV audio generation returned to the caller.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        config_path: Optional[str] = None,
        use_cuda: bool = False,
    ):
        self.configured_model_path = model_path
        self.configured_config_path = config_path
        self.use_cuda = use_cuda

        self._voice = None
        self._resolved_model_path: Optional[str] = None
        self._resolved_config_path: Optional[str] = None
        self._last_error: Optional[str] = None

    def _locate_voice_files(self) -> Tuple[Optional[str], Optional[str]]:
        """Search for valid Piper .onnx and companion .json config files."""
        # 1. If explicit path is configured, verify it (do not fallback)
        if self.configured_model_path:
            p = Path(self.configured_model_path)
            if p.is_file():
                cfg = Path(self.configured_config_path) if self.configured_config_path else Path(f"{p}.json")
                if cfg.is_file():
                    return str(p), str(cfg)
                if p.suffix == ".onnx":
                    alt_cfg = p.with_suffix(".onnx.json")
                    if alt_cfg.is_file():
                        return str(p), str(alt_cfg)
            return None, None

        # 2. Check standard local model directories
        search_dirs = [
            Path.cwd() / "models" / "piper",
            Path(__file__).resolve().parents[4] / "models" / "piper",
            Path.home() / ".local" / "share" / "piper",
        ]

        for s_dir in search_dirs:
            if s_dir.is_dir():
                for onnx_file in s_dir.glob("*.onnx"):
                    cfg_file = Path(f"{onnx_file}.json")
                    if cfg_file.is_file():
                        return str(onnx_file), str(cfg_file)
                    alt_cfg = onnx_file.with_suffix(".onnx.json")
                    if alt_cfg.is_file():
                        return str(onnx_file), str(alt_cfg)

        return None, None

    def list_available_voices(self) -> List[Dict[str, Any]]:
        """Discover all valid local Piper voice models."""
        search_dirs = [
            Path.cwd() / "models" / "piper",
            Path(__file__).resolve().parents[4] / "models" / "piper",
            Path.home() / ".local" / "share" / "piper",
        ]

        voices: List[Dict[str, Any]] = []
        seen_paths = set()

        for s_dir in search_dirs:
            if not s_dir.is_dir():
                continue
            for onnx_file in s_dir.glob("*.onnx"):
                p_str = str(onnx_file.resolve())
                if p_str in seen_paths:
                    continue
                seen_paths.add(p_str)

                cfg_file = Path(f"{onnx_file}.json")
                if not cfg_file.is_file():
                    cfg_file = onnx_file.with_suffix(".onnx.json")

                details: Dict[str, Any] = {
                    "name": onnx_file.stem,
                    "model_path": str(onnx_file),
                    "config_path": str(cfg_file) if cfg_file.is_file() else None,
                    "has_config": cfg_file.is_file(),
                }

                if cfg_file.is_file():
                    try:
                        with open(cfg_file, "r", encoding="utf-8") as f:
                            meta = json.load(f)
                            details["language"] = meta.get("language", {}).get("code", "en_US")
                            details["sample_rate"] = meta.get("audio", {}).get("sample_rate", 22050)
                            details["quality"] = meta.get("dataset", "medium")
                    except Exception:
                        details["language"] = "en_US"

                voices.append(details)

        return voices

    def _load_voice(self):
        """Load PiperVoice model into memory."""
        if self._voice is not None:
            return self._voice

        model_path, config_path = self._locate_voice_files()
        if not model_path or not config_path:
            target_desc = self.configured_model_path or "models/piper/*.onnx"
            self._last_error = (
                f"Piper voice model was not found at '{target_desc}'. "
                "Automatic downloads are disabled for offline privacy. "
                "Please run 'python -m aura_agent.scripts.setup_voice --piper en_US-lessac-medium' "
                "or place the voice .onnx and .onnx.json files into models/piper/."
            )
            logger.warning(self._last_error)
            raise TTSModelNotFoundError(self._last_error)

        try:
            from piper import PiperVoice
        except ImportError as e:
            self._last_error = f"piper-tts library is not installed: {e}"
            logger.error(self._last_error)
            raise TTSError(self._last_error) from e

        logger.info(
            "Loading local Piper voice model from '%s' (config='%s', cuda=%s)",
            model_path,
            config_path,
            self.use_cuda,
        )

        try:
            self._voice = PiperVoice.load(
                model_path=model_path,
                config_path=config_path,
                use_cuda=self.use_cuda,
            )
            self._resolved_model_path = model_path
            self._resolved_config_path = config_path
            self._last_error = None
            logger.info("Piper voice model '%s' loaded successfully.", os.path.basename(model_path))
            return self._voice
        except Exception as e:
            self._voice = None
            self._last_error = f"Failed to load Piper voice model: {e}"
            logger.error(self._last_error, exc_info=True)
            raise TTSError(self._last_error) from e

    def is_available(self) -> bool:
        """Check if voice files exist and can be loaded."""
        if self._voice is not None:
            return True
        model_path, config_path = self._locate_voice_files()
        return bool(model_path and config_path)

    def get_status(self) -> Dict[str, Any]:
        """Return diagnostic status information."""
        model_path, config_path = self._locate_voice_files()
        available = bool(model_path and config_path)
        voices = self.list_available_voices()
        return {
            "engine": "piper-tts",
            "available": available,
            "model_path": model_path or self.configured_model_path,
            "config_path": config_path or self.configured_config_path,
            "use_cuda": self.use_cuda,
            "voice_count": len(voices),
            "available_voices": [v["name"] for v in voices],
            "error": self._last_error if not available else None,
        }

    def _sync_synthesize(self, text: str) -> bytes:
        """Synchronously synthesize cleaned text to WAV audio in memory."""
        cleaned = clean_text_for_speech(text)
        if not cleaned:
            raise TTSInvalidTextError("Cannot synthesize empty text after speech filtering.")

        voice = self._load_voice()
        buf = io.BytesIO()

        try:
            with wave.open(buf, "wb") as wav_file:
                voice.synthesize_wav(cleaned, wav_file)

            wav_bytes = buf.getvalue()
            logger.info("Synthesized %d bytes of WAV audio for speech (%d chars).", len(wav_bytes), len(cleaned))
            return wav_bytes
        except Exception as e:
            logger.error("Synthesis failed for text '%s': %s", cleaned[:50], e, exc_info=True)
            raise TTSError(f"Piper synthesis failed: {e}") from e

    async def synthesize(self, text: str) -> bytes:
        """Asynchronously synthesize text to WAV audio using standard worker thread."""
        return await asyncio.to_thread(self._sync_synthesize, text)
