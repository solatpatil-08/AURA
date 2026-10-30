import io
import logging
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import anyio

# Defensive compatibility patch for PyAV metadata_errors parameter in newer versions
try:
    import av
    _orig_av_open = av.open

    def _compat_av_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)

    av.open = _compat_av_open
except Exception:
    pass

logger = logging.getLogger("aura.voice.stt")


class STTError(Exception):
    """Base exception for Speech-to-Text operations."""
    pass


class STTModelNotFoundError(STTError):
    """Raised when the specified Whisper model is not found locally."""
    pass


class STTInvalidAudioError(STTError):
    """Raised when provided audio cannot be parsed or decoded."""
    pass


class BaseSTTService(ABC):
    """Replaceable interface for Speech-to-Text inference."""

    @abstractmethod
    def is_available(self) -> bool:
        """Check if STT engine and local model are available."""
        pass

    @abstractmethod
    def get_status(self) -> Dict[str, Any]:
        """Return engine diagnostic status."""
        pass

    @abstractmethod
    async def transcribe(self, audio_data: bytes, filename: str = "audio.wav") -> str:
        """Transcribe audio bytes to text asynchronously.

        Args:
            audio_data: Raw audio binary content (WAV, WebM, OGG, etc.).
            filename: Original or suggested filename for MIME hints.

        Returns:
            Recognized transcript text.
        """
        pass


class FasterWhisperSTT(BaseSTTService):
    """Local Speech-to-Text adapter using faster-whisper (CTranslate2).

    Guarantees:
    - 100% on-device local execution.
    - Zero automatic model downloads at runtime (local_files_only=True).
    - Offloaded to threadpool to prevent blocking the async event loop.
    """

    def __init__(
        self,
        model_size_or_path: str = "base.en",
        model_dir: Optional[str] = None,
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "en",
    ):
        self.model_size_or_path = model_size_or_path
        self.model_dir = model_dir
        self.device = device
        self.compute_type = compute_type
        self.language = language

        self._model = None
        self._initialization_attempted = False
        self._last_error: Optional[str] = None

    def _resolve_model_path(self) -> str:
        """Resolve model path from directory or model identifier."""
        if self.model_dir:
            candidate = os.path.join(self.model_dir, self.model_size_or_path)
            if os.path.exists(candidate):
                return candidate
            if os.path.exists(self.model_dir):
                return self.model_dir
        return self.model_size_or_path

    def _load_model(self):
        """Load the faster-whisper model strictly from local files."""
        if self._model is not None:
            return self._model

        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            self._last_error = f"faster-whisper is not installed: {e}"
            logger.error(self._last_error)
            raise STTError(self._last_error) from e

        target = self._resolve_model_path()
        logger.info(
            "Loading local faster-whisper model '%s' (device=%s, compute_type=%s, local_files_only=True)",
            target,
            self.device,
            self.compute_type,
        )

        try:
            # Enforce local_files_only=True: NEVER trigger automatic background downloads
            self._model = WhisperModel(
                target,
                device=self.device,
                compute_type=self.compute_type,
                download_root=self.model_dir,
                local_files_only=True,
            )
            self._last_error = None
            logger.info("faster-whisper model '%s' loaded successfully.", target)
            return self._model
        except Exception as e:
            err_msg = str(e)
            self._model = None
            # Differentiate missing model from other errors
            if (
                "LocalEntryNotFoundError" in type(e).__name__
                or "not found" in err_msg.lower()
                or "invalid model size" in err_msg.lower()
                or isinstance(e, FileNotFoundError)
            ):
                self._last_error = (
                    f"Whisper model '{target}' was not found locally on disk. "
                    "Automatic network downloads are disabled to preserve local-first privacy. "
                    f"Please run 'python -m aura_agent.scripts.setup_voice --whisper {self.model_size_or_path}' "
                    "or place model files in your configured models directory."
                )
                logger.warning(self._last_error)
                raise STTModelNotFoundError(self._last_error) from e
            else:
                self._last_error = f"Failed to initialize faster-whisper model: {e}"
                logger.error(self._last_error, exc_info=True)
                raise STTError(self._last_error) from e

    def is_available(self) -> bool:
        """Check if local model is ready without raising exceptions."""
        if self._model is not None:
            return True
        try:
            self._load_model()
            return True
        except Exception:
            return False

    def get_status(self) -> Dict[str, Any]:
        """Return diagnostic status information."""
        available = self.is_available()
        return {
            "engine": "faster-whisper",
            "available": available,
            "model": self.model_size_or_path,
            "device": self.device,
            "compute_type": self.compute_type,
            "language": self.language,
            "model_dir": self.model_dir,
            "error": self._last_error if not available else None,
        }

    def _sync_transcribe(self, audio_data: bytes) -> str:
        """Synchronously execute transcription using CTranslate2."""
        if not audio_data or len(audio_data) < 100:
            logger.debug("Audio buffer is empty or too short (< 100 bytes).")
            return ""

        model = self._load_model()
        audio_stream = io.BytesIO(audio_data)

        try:
            segments, info = model.transcribe(
                audio_stream,
                language=self.language,
                beam_size=5,
                vad_filter=True,
            )

            transcript_parts = []
            for segment in segments:
                text = segment.text.strip()
                if text:
                    transcript_parts.append(text)

            full_transcript = " ".join(transcript_parts).strip()
            logger.info("Transcribed audio successfully: '%s'", full_transcript)
            return full_transcript
        except Exception as e:
            if "av.error" in str(type(e)).lower() or "invalid data" in str(e).lower():
                raise STTInvalidAudioError(f"Corrupt or unsupported audio format: {e}") from e
            raise STTError(f"Transcription execution failed: {e}") from e

    async def transcribe(self, audio_data: bytes, filename: str = "audio.wav") -> str:
        """Asynchronously transcribe audio using an isolated worker thread."""
        return await anyio.to_thread.run_sync(self._sync_transcribe, audio_data)
