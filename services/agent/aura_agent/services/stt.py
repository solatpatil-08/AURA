import io
import logging
import os
import asyncio
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

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
    def list_available_models(self) -> List[Dict[str, Any]]:
        """List locally available Whisper models."""
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
    - Multilingual Whisper base model support.
    - CPU INT8 by default, with verified GPU fallback.
    - Offloaded to threadpool to prevent blocking the async event loop.
    """

    def __init__(
        self,
        model_size_or_path: str = "base",
        model_dir: Optional[str] = None,
        device: str = "cpu",
        compute_type: str = "int8",
        language: Optional[str] = None,
    ):
        self.requested_model = model_size_or_path
        self.configured_model_dir = model_dir
        self.requested_device = device
        self.requested_compute_type = compute_type
        self.language = language

        # Verified execution parameters
        self.active_device, self.active_compute_type = self._determine_hardware_acceleration(
            device, compute_type
        )

        self._model = None
        self._resolved_model_path: Optional[str] = None
        self._last_error: Optional[str] = None

    @staticmethod
    def _determine_hardware_acceleration(device: str, compute_type: str) -> Tuple[str, str]:
        """Detect and verify hardware capabilities.

        Defaults to CPU INT8. Only enables CUDA if CTranslate2 CUDA compute is verified.
        """
        if device.lower() in ("cuda", "gpu", "auto"):
            try:
                import ctranslate2
                cuda_types = ctranslate2.get_supported_compute_types("cuda")
                if cuda_types:
                    chosen_compute = "float16" if "float16" in cuda_types else "int8_float16"
                    logger.info("GPU acceleration verified for CTranslate2: compute=%s", chosen_compute)
                    return "cuda", chosen_compute
                else:
                    logger.info("CUDA not supported by CTranslate2 on this system. Using CPU INT8.")
            except Exception as e:
                logger.info("GPU detection skipped or failed (%s). Using CPU INT8.", e)

        # Default configuration: CPU INT8
        return "cpu", compute_type or "int8"

    def _resolve_model_path(self) -> str:
        """Resolve model path from directory or search local model directories.

        Search order:
        1. Explicitly configured directory with requested model name (no workspace fallback)
        2. Workspace models/whisper/<requested_model>
        3. Fallback candidates: base -> base.en -> tiny.en
        """
        # If absolute or direct directory provided
        if self.configured_model_dir:
            cand = Path(self.configured_model_dir) / self.requested_model
            if cand.is_dir() and (cand / "model.bin").is_file():
                return str(cand)
            if Path(self.configured_model_dir).is_dir() and (Path(self.configured_model_dir) / "model.bin").is_file():
                return str(self.configured_model_dir)
            return str(cand)

        search_roots = [
            Path.cwd() / "models" / "whisper",
            Path(__file__).resolve().parents[4] / "models" / "whisper",
            Path.home() / ".cache" / "huggingface" / "hub",
        ]

        # 1. Exact match for requested model
        for root in search_roots:
            if not root.is_dir():
                continue
            cand = root / self.requested_model
            if cand.is_dir() and (cand / "model.bin").is_file():
                return str(cand)

        # 2. Fallbacks if requested model is not found
        fallback_order = ["base", "base.en", "tiny.en"]
        if self.requested_model in fallback_order:
            fallback_order.remove(self.requested_model)

        for fb in fallback_order:
            for root in search_roots:
                if not root.is_dir():
                    continue
                cand = root / fb
                if cand.is_dir() and (cand / "model.bin").is_file():
                    logger.warning("Requested Whisper model '%s' not found. Falling back to local '%s'.", self.requested_model, fb)
                    return str(cand)

        # Return original identifier if nothing found locally (will trigger clean model not found error)
        return self.requested_model

    def list_available_models(self) -> List[Dict[str, Any]]:
        """List all discovered local Whisper models on disk."""
        search_roots = [
            Path.cwd() / "models" / "whisper",
            Path(__file__).resolve().parents[4] / "models" / "whisper",
        ]

        models: List[Dict[str, Any]] = []
        seen = set()

        for root in search_roots:
            if not root.is_dir():
                continue
            for model_dir in root.iterdir():
                if model_dir.is_dir() and (model_dir / "model.bin").is_file():
                    p_str = str(model_dir.resolve())
                    if p_str in seen:
                        continue
                    seen.add(p_str)
                    name = model_dir.name
                    multilingual = not name.endswith(".en")
                    size_bytes = (model_dir / "model.bin").stat().st_size
                    models.append({
                        "name": name,
                        "path": str(model_dir),
                        "multilingual": multilingual,
                        "size_mb": round(size_bytes / (1024 * 1024), 1),
                        "is_active": str(model_dir) == self._resolved_model_path,
                    })

        return models

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
            self.active_device,
            self.active_compute_type,
        )

        try:
            # Enforce local_files_only=True: NEVER trigger automatic background downloads
            self._model = WhisperModel(
                target,
                device=self.active_device,
                compute_type=self.active_compute_type,
                download_root=self.configured_model_dir,
                local_files_only=True,
            )
            self._resolved_model_path = target
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
                    f"Please run 'python -m aura_agent.scripts.setup_voice --whisper {self.requested_model}' "
                    "or place model files in your models/whisper directory."
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
        target = self._resolve_model_path()
        if not os.path.exists(target):
            return False
        try:
            self._load_model()
            return True
        except Exception:
            return False

    def get_status(self) -> Dict[str, Any]:
        """Return diagnostic status information."""
        available = self.is_available()
        models = self.list_available_models()
        return {
            "engine": "faster-whisper",
            "available": available,
            "model": self.requested_model,
            "resolved_model_path": self._resolved_model_path,
            "device": self.active_device,
            "compute_type": self.active_compute_type,
            "language": self.language or "auto",
            "available_models": [m["name"] for m in models],
            "error": self._last_error if not available else None,
        }

    def _sync_transcribe(self, audio_data: bytes) -> Tuple[str, Optional[str], Optional[float]]:
        """Synchronously execute transcription using CTranslate2."""
        if not audio_data or len(audio_data) < 100:
            logger.debug("Audio buffer is empty or too short (< 100 bytes).")
            return "", None, 0.0

        model = self._load_model()
        audio_stream = io.BytesIO(audio_data)

        try:
            # If self.language is None or 'auto', whisper auto-detects language
            transcribe_lang = self.language if self.language and self.language != "auto" else None

            segments, info = model.transcribe(
                audio_stream,
                language=transcribe_lang,
                beam_size=5,
                vad_filter=True,
            )

            transcript_parts = []
            for segment in segments:
                text = segment.text.strip()
                if text:
                    transcript_parts.append(text)

            full_transcript = " ".join(transcript_parts).strip()
            detected_lang = getattr(info, "language", None)
            duration = getattr(info, "duration", None)

            logger.info("Transcribed audio successfully: '%s' (lang=%s, duration=%.2fs)", full_transcript, detected_lang, duration or 0.0)
            return full_transcript, detected_lang, duration
        except Exception as e:
            if "av.error" in str(type(e)).lower() or "invalid data" in str(e).lower():
                raise STTInvalidAudioError(f"Corrupt or unsupported audio format: {e}") from e
            raise STTError(f"Transcription execution failed: {e}") from e

    async def transcribe(self, audio_data: bytes, filename: str = "audio.wav") -> str:
        """Asynchronously transcribe audio using standard worker thread."""
        transcript, _, _ = await asyncio.to_thread(self._sync_transcribe, audio_data)
        return transcript

    async def transcribe_with_metadata(self, audio_data: bytes, filename: str = "audio.wav") -> Tuple[str, Optional[str], Optional[float]]:
        """Asynchronously transcribe audio and return transcript, language, and duration."""
        return await asyncio.to_thread(self._sync_transcribe, audio_data)
