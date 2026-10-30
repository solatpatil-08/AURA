import glob
import io
import logging
import os
import wave
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import anyio

logger = logging.getLogger("aura.voice.tts")


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
    async def synthesize(self, text: str) -> bytes:
        """Synthesize text to local WAV audio bytes asynchronously.

        Args:
            text: Conversational text to turn into speech.

        Returns:
            Binary WAV audio content.
        """
        pass


class PiperTTSService(BaseTTSService):
    """Local Text-to-Speech adapter using Piper TTS (ONNX Runtime).

    Guarantees:
    - 100% on-device local execution using ONNX.
    - Zero external cloud TTS APIs or telemetry.
    - Graceful handling of missing voice files.
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

    def _locate_voice_files(self) -> tuple[Optional[str], Optional[str]]:
        """Search for valid Piper .onnx and .onnx.json files."""
        # 1. If explicit paths configured, verify them without falling back
        if self.configured_model_path:
            if os.path.exists(self.configured_model_path):
                cfg = self.configured_config_path or f"{self.configured_model_path}.json"
                if os.path.exists(cfg):
                    return self.configured_model_path, cfg
                # Check without redundant extensions
                if self.configured_model_path.endswith(".onnx"):
                    alt_cfg = self.configured_model_path[:-5] + ".onnx.json"
                    if os.path.exists(alt_cfg):
                        return self.configured_model_path, alt_cfg
            return None, None

        # 2. Check standard local model directories
        search_dirs = [
            os.path.join(os.getcwd(), "models", "piper"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), "models", "piper"),
            os.path.join(os.path.expanduser("~"), ".local", "share", "piper"),
        ]

        for s_dir in search_dirs:
            if os.path.isdir(s_dir):
                onnx_candidates = glob.glob(os.path.join(s_dir, "*.onnx"))
                for candidate in onnx_candidates:
                    cfg_candidate = f"{candidate}.json"
                    if os.path.exists(cfg_candidate):
                        return candidate, cfg_candidate

        return None, None

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
                "or place the voice .onnx and .onnx.json files into models/piper/ (verifying license terms)."
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
        return {
            "engine": "piper-tts",
            "available": available,
            "model_path": model_path or self.configured_model_path,
            "config_path": config_path or self.configured_config_path,
            "use_cuda": self.use_cuda,
            "error": self._last_error if not available else None,
        }

    def _sync_synthesize(self, text: str) -> bytes:
        """Synchronously synthesize text to WAV audio in memory."""
        cleaned = text.strip()
        if not cleaned:
            raise TTSInvalidTextError("Cannot synthesize empty text.")

        voice = self._load_voice()
        buf = io.BytesIO()

        try:
            with wave.open(buf, "wb") as wav_file:
                voice.synthesize_wav(cleaned, wav_file)

            wav_bytes = buf.getvalue()
            logger.info("Synthesized %d bytes of WAV audio for text (%d chars).", len(wav_bytes), len(cleaned))
            return wav_bytes
        except Exception as e:
            logger.error("Synthesis failed for text '%s': %s", cleaned[:50], e, exc_info=True)
            raise TTSError(f"Piper synthesis failed: {e}") from e

    async def synthesize(self, text: str) -> bytes:
        """Asynchronously synthesize text to WAV audio using threadpool worker."""
        return await anyio.to_thread.run_sync(self._sync_synthesize, text)
