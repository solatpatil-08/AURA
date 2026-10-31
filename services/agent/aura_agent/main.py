import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from aura_agent.config import settings
from aura_agent.models.db import DatabaseManager
from aura_agent.services.ollama import OllamaClient
from aura_agent.services.history import ConversationHistoryService
from aura_agent.services.stt import FasterWhisperSTT
from aura_agent.services.tts import PiperTTSService
from aura_agent.services.browser import BrowserService
from aura_agent.services.memory import MemoryService
from aura_agent.tools import AuditLogger, create_default_registry
from aura_agent.services.agent_loop import AgentLoop
from aura_agent.services.orchestrator import TaskOrchestrator
from aura_agent.api import health, system, chat, voice, tools, memory, tasks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("aura.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: Initialize SQLite database, Ollama, Voice services, and Tool Registry."""
    logger.info("Initializing AURA Agent local database at %s", settings.database_url)
    db_manager = DatabaseManager(settings.database_url)
    await db_manager.init_schema()

    logger.info("Connecting to local Ollama at %s (Model: %s)", settings.ollama_base_url, settings.model_name)
    ollama_client = OllamaClient(
        base_url=settings.ollama_base_url,
        timeout=settings.request_timeout_seconds,
    )
    history_service = ConversationHistoryService(db_manager.session_factory)

    # Initialize Local Voice Subsystem (faster-whisper STT & Piper TTS)
    logger.info(
        "Initializing local STT service (Model: %s, Device: %s, Compute: %s)",
        settings.whisper_model_size,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    stt_service = FasterWhisperSTT(
        model_size_or_path=settings.whisper_model_size,
        model_dir=settings.whisper_model_dir,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        language=settings.stt_language,
    )

    logger.info(
        "Initializing local TTS service (Piper model: %s, Cuda: %s)",
        settings.piper_model_path or "default search path",
        settings.piper_use_cuda,
    )
    tts_service = PiperTTSService(
        model_path=settings.piper_model_path,
        config_path=settings.piper_config_path,
        use_cuda=settings.piper_use_cuda,
    )

    # Phase 5, 6 & 7: Controlled Computer Actions, Browser Research, & Persistent Memory
    logger.info("Initializing Phase 5, 6 & 7 Tools, Browser Service, & Persistent Memory")
    audit_logger = AuditLogger(db_manager.session_factory)
    memory_service = MemoryService(db_manager.session_factory)
    browser_service = BrowserService(
        user_data_dir=settings.browser_user_data_dir,
        headless=settings.browser_headless,
        timeout_seconds=settings.browser_timeout_seconds,
        max_content_chars=settings.browser_max_content_chars,
        domain_allowlist=settings.browser_domain_allowlist,
    )
    tool_registry = create_default_registry(
        workspace_root=settings.workspace_root,
        notes_dir=settings.notes_dir,
        allowed_apps=settings.allowed_applications,
        browser_service=browser_service,
        ollama_client=ollama_client,
        memory_service=memory_service,
    )
    agent_loop = AgentLoop(
        ollama_client=ollama_client,
        tool_registry=tool_registry,
        audit_logger=audit_logger,
        max_iterations=settings.max_tool_iterations,
    )
    orchestrator = TaskOrchestrator(
        session_factory=db_manager.session_factory,
        tool_registry=tool_registry,
        audit_logger=audit_logger,
        ollama_client=ollama_client,
    )

    app.state.db_manager = db_manager
    app.state.ollama_client = ollama_client
    app.state.history_service = history_service
    app.state.stt_service = stt_service
    app.state.tts_service = tts_service
    app.state.audit_logger = audit_logger
    app.state.tool_registry = tool_registry
    app.state.agent_loop = agent_loop
    app.state.browser_service = browser_service
    app.state.memory_service = memory_service
    app.state.orchestrator = orchestrator

    yield

    logger.info("Closing browser automation context...")
    await browser_service.close()
    logger.info("AURA Agent service shutting down.")


def create_app(lifespan_override=lifespan) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="AURA Agent Core",
        description="Local-first AI conversation, reasoning, and voice engine",
        version="0.1.0",
        lifespan=lifespan_override,
    )

    # 1. CORS Configuration (Localhost Electron and dev servers)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    # 2. Localhost-only & Request size guard middleware
    @app.middleware("http")
    async def security_guard_middleware(request: Request, call_next):
        # Differentiate audio upload payload limit from standard text limits
        max_bytes = (
            settings.max_audio_upload_bytes
            if request.url.path.startswith("/api/voice/transcribe")
            else 2 * 1024 * 1024
        )
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > max_bytes:
            return JSONResponse(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                content={"detail": f"Request payload exceeds size limit ({max_bytes} bytes max)."},
            )

        # Enforce localhost origin/host
        host = request.headers.get("host", "")
        if host and not (host.startswith("127.0.0.1") or host.startswith("localhost")):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Forbidden: AURA Agent is strictly bound to localhost."},
            )

        # Enforce Origin header check to prevent Cross-Site Localhost Hijacking (DNS rebinding / CSRF)
        origin = request.headers.get("origin")
        if origin and origin not in ("null", "file://"):
            if origin not in settings.allowed_cors_origins:
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": f"Forbidden: Untrusted origin '{origin}'."},
                )

        response = await call_next(request)
        return response

    # 3. Mount API Routers
    app.include_router(health.router)
    app.include_router(system.router)
    app.include_router(chat.router)
    app.include_router(voice.router)
    app.include_router(tools.router)
    app.include_router(memory.router)
    app.include_router(tasks.router)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "aura_agent.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )
