from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """AURA Agent runtime configuration.

    Strict localhost binding, local-first AI parameters, and on-device voice settings.
    """

    model_config = SettingsConfigDict(
        env_prefix="AURA_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server binding (strictly localhost)
    host: str = "127.0.0.1"
    port: int = 8000

    # Local Ollama connection
    ollama_base_url: str = "http://127.0.0.1:11434"
    model_name: str = "qwen3.5:4b"
    request_timeout_seconds: float = 60.0

    # Local persistence
    database_url: str = "sqlite+aiosqlite:///aura_conversations.db"

    # Local Speech Recognition (faster-whisper)
    whisper_model_size: str = "base"
    whisper_model_dir: Optional[str] = None
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    stt_language: Optional[str] = None
    max_recording_seconds: int = 60

    # Local Text-to-Speech (Piper)
    piper_model_path: Optional[str] = None
    piper_config_path: Optional[str] = None
    piper_voice_name: str = "en_US-lessac-medium"
    piper_use_cuda: bool = False
    voice_clean_speech: bool = True

    # General voice feature flag
    voice_enabled: bool = True

    # Phase 5: Controlled Computer Actions & Tool Policy
    workspace_root: str = "C:\\Projects\\AURA"
    notes_dir: Optional[str] = None  # Defaults to <workspace_root>/notes if None
    tool_execution_policy: str = "request-review"  # 'strict' | 'request-review' | 'always-proceed'
    tool_timeout_seconds: float = 10.0
    max_file_read_bytes: int = 5 * 1024 * 1024  # 5 MB max for reading files
    max_tool_iterations: int = 5
    allowed_applications: dict = {
        "notepad": "C:\\Windows\\System32\\notepad.exe",
        "calc": "C:\\Windows\\System32\\calc.exe",
        "explorer": "C:\\Windows\\explorer.exe",
        "code": "code",
    }

    # Phase 6: Browser Research & Automation
    browser_headless: bool = True
    browser_timeout_seconds: float = 20.0
    browser_user_data_dir: Optional[str] = None  # Defaults to %LOCALAPPDATA%\AURA\browser_profile
    browser_max_content_chars: int = 12000
    search_engine_url: str = "https://html.duckduckgo.com/html/"
    browser_domain_allowlist: Optional[List[str]] = None

    # Phase 7: Persistent Local Memory
    memory_enabled: bool = True
    memory_max_injected: int = 3
    memory_relevance_threshold: float = 0.1
    memory_default_retention_days: Optional[int] = None

    # Phase 8: Task Orchestration & Multi-Step Execution
    task_timeout_seconds: float = 120.0
    task_step_timeout_seconds: float = 30.0
    task_max_steps: int = 15
    task_max_retries_per_step: int = 2
    task_max_total_tool_calls: int = 10

    # Request validation & security limits
    max_request_chars: int = 32000
    max_audio_upload_bytes: int = 15 * 1024 * 1024  # 15 MB max audio upload
    allowed_cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


settings = Settings()
