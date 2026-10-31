import pytest
import pytest_asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator
import httpx
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from aura_agent.main import create_app
from aura_agent.models.db import Base, DatabaseManager
from aura_agent.services.history import ConversationHistoryService
from aura_agent.services.ollama import OllamaClient, OllamaModelNotFoundError, OllamaConnectionError


@asynccontextmanager
async def mock_lifespan(app):
    """Test-isolated no-op lifespan context manager."""
    yield


class MockSTTService:
    """Mock Speech-to-Text service for unit testing without loading neural models."""

    def __init__(self, transcript="Mocked transcribed speech.", available=True):
        self.mock_transcript = transcript
        self.available = available

    def is_available(self) -> bool:
        return self.available

    def get_status(self) -> dict:
        return {
            "engine": "mock-whisper",
            "available": self.available,
            "model": "base",
            "device": "cpu",
            "compute_type": "int8",
            "language": "en",
            "available_models": ["base", "base.en", "tiny.en"],
            "error": None if self.available else "Mock STT unavailable",
        }

    def list_available_models(self) -> list:
        return [{"name": "base", "path": "models/whisper/base", "multilingual": True, "size_mb": 140.0}]

    async def transcribe(self, audio_data: bytes, filename: str = "audio.wav") -> str:
        return self.mock_transcript

    async def transcribe_with_metadata(self, audio_data: bytes, filename: str = "audio.wav"):
        return self.mock_transcript, "en", 1.5


class MockTTSService:
    """Mock Text-to-Speech service for unit testing."""

    def __init__(self, available=True):
        self.available = available

    def is_available(self) -> bool:
        return self.available

    def get_status(self) -> dict:
        return {
            "engine": "mock-piper",
            "available": self.available,
            "model_path": "models/piper/en_US-lessac-medium.onnx",
            "config_path": "models/piper/en_US-lessac-medium.onnx.json",
            "use_cuda": False,
            "voice_count": 1,
            "available_voices": ["en_US-lessac-medium"],
            "error": None if self.available else "Mock TTS unavailable",
        }

    def list_available_voices(self) -> list:
        return [{"name": "en_US-lessac-medium", "model_path": "models/piper/en_US-lessac-medium.onnx", "language": "en_US"}]

    async def synthesize(self, text: str) -> bytes:
        import io, wave
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(22050)
            wav.writeframes(b"\x00\x00" * 100)
        return buf.getvalue()


class MockOllamaClient:
    """Mocked Ollama client simulating local model runner states without network."""

    def __init__(self, models: list[str] = None, fail_mode: str = None):
        self.models = models or ["qwen3.5:4b", "llama3.2:3b"]
        self.fail_mode = fail_mode  # 'offline', 'missing_model', 'timeout'

    async def get_tags(self) -> list[str]:
        if self.fail_mode == "offline":
            raise OllamaConnectionError("Cannot connect to Ollama daemon on localhost.")
        return self.models

    async def is_model_installed(self, model_name: str) -> bool:
        if self.fail_mode == "offline":
            raise OllamaConnectionError("Cannot connect to Ollama daemon on localhost.")
        if self.fail_mode == "missing_model":
            return False
        return any(m.lower() == model_name.lower() for m in self.models)

    async def chat(self, messages, model, system_prompt=None, tools=None):
        if self.fail_mode == "offline":
            raise OllamaConnectionError("Ollama unreachable.")
        if self.fail_mode == "missing_model" or not await self.is_model_installed(model):
            raise OllamaModelNotFoundError(f"Model '{model}' is not installed in local Ollama.")

        last_prompt = messages[-1]["content"] if messages else ""
        return {
            "content": f"Mocked response to: {last_prompt}",
            "tool_calls": [],
            "model": model,
            "total_duration_ms": 150.0,
            "eval_count": 42,
        }

    async def chat_stream(self, messages, model, system_prompt=None):
        if self.fail_mode == "offline":
            raise OllamaConnectionError("Ollama unreachable.")
        if self.fail_mode == "missing_model" or not await self.is_model_installed(model):
            raise OllamaModelNotFoundError(f"Model '{model}' is not installed in local Ollama.")

        tokens = ["This ", "is ", "a ", "streamed ", "mock ", "response."]
        for token in tokens:
            yield token


@pytest_asyncio.fixture
async def in_memory_db():
    """Create a clean in-memory SQLite async database for test isolation."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    yield session_factory
    await engine.dispose()


@pytest_asyncio.fixture
def mock_workspace(tmp_path):
    """Create a dedicated temporary workspace directory for safe test execution."""
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    notes = ws / "notes"
    notes.mkdir(parents=True, exist_ok=True)

    # Populate dummy files
    (ws / "sample.txt").write_text("Hello from AURA test file.", encoding="utf-8")
    (ws / "subfolder").mkdir(parents=True, exist_ok=True)
    (ws / "subfolder" / "nested.txt").write_text("Nested file content.", encoding="utf-8")

    return ws


@pytest_asyncio.fixture
async def app_instance(in_memory_db, mock_workspace):
    """Create a configured FastAPI test application with in-memory DB and mock Ollama and Tool Registry."""
    from aura_agent.tools import AuditLogger, create_default_registry
    from aura_agent.services.agent_loop import AgentLoop
    from aura_agent.services.memory import MemoryService
    from aura_agent.services.orchestrator import TaskOrchestrator

    app = create_app(lifespan_override=mock_lifespan)

    # Override state
    ollama_mock = MockOllamaClient(models=["qwen3.5:4b"])
    history_svc = ConversationHistoryService(in_memory_db)
    audit_logger = AuditLogger(in_memory_db)
    memory_svc = MemoryService(in_memory_db)
    stt_svc = MockSTTService()
    tts_svc = MockTTSService()
    tool_reg = create_default_registry(
        workspace_root=str(mock_workspace),
        notes_dir=str(mock_workspace / "notes"),
        memory_service=memory_svc,
    )
    agent_loop = AgentLoop(
        ollama_client=ollama_mock,
        tool_registry=tool_reg,
        audit_logger=audit_logger,
    )
    orchestrator = TaskOrchestrator(
        session_factory=in_memory_db,
        tool_registry=tool_reg,
        audit_logger=audit_logger,
        ollama_client=ollama_mock,
    )

    app.state.history_service = history_svc
    app.state.ollama_client = ollama_mock
    app.state.audit_logger = audit_logger
    app.state.tool_registry = tool_reg
    app.state.agent_loop = agent_loop
    app.state.memory_service = memory_svc
    app.state.orchestrator = orchestrator
    app.state.stt_service = stt_svc
    app.state.tts_service = tts_svc

    return app


@pytest_asyncio.fixture
async def client(app_instance) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Async HTTP test client."""
    transport = httpx.ASGITransport(app=app_instance)
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as ac:
        yield ac
