# AURA Agent Service

Python FastAPI local backend service for AURA.

## Responsibilities

1. **Local Ollama Integration**: Interacts with the local Ollama instance (`127.0.0.1:11434`) via asynchronous HTTP requests (`httpx`).
2. **On-Device Speech-to-Text (STT)**: Transcribes user microphone audio locally using `faster-whisper` (CTranslate2).
3. **Local Text-to-Speech (TTS)**: Synthesizes conversational responses into WAV audio using `Piper TTS` (ONNX Runtime).
4. **Streaming Tokens**: Emits Server-Sent Events (SSE) token by token for low-latency desktop assistant responses.
5. **Conversation Persistence**: Stores multi-turn chat sessions and messages in SQLite with WAL mode (`aura_conversations.db`).
6. **Privacy & Security**: Binds strictly to `127.0.0.1`, enforces request payload limits (2MB text, 15MB audio), rejects non-localhost Host headers, and strictly avoids cloud AI calls.

## API Endpoints

- `GET /health`: Basic health check.
- `GET /api/system/status`: Real-time backend, Ollama connection, and STT/TTS engine status.
- `POST /api/chat`: Accepts conversation prompts (streamed or buffered response).
- `GET /api/chat/history/{session_id}`: Retrieves previous conversation messages for a session.
- `POST /api/voice/transcribe`: Accepts multipart audio (`file`) and transcribes it on-device.
- `POST /api/voice/synthesize`: Synthesizes text into binary WAV audio.
- `GET /api/voice/status`: Diagnostic readiness information for faster-whisper and Piper.

## Voice Setup & Verification

```powershell
# Setup models explicitly (automatic runtime downloads are disabled)
.venv\Scripts\python -m aura_agent.scripts.setup_voice --whisper base.en
.venv\Scripts\python -m aura_agent.scripts.setup_voice --piper en_US-lessac-medium

# Verify the on-device roundtrip (synthesize speech -> transcribe audio)
.venv\Scripts\python -m aura_agent.scripts.setup_voice --verify
```

## Configuration

Configured via environment variables or `.env` file (parsed by Pydantic `BaseSettings` in `aura_agent/config.py`):

| Variable | Default | Description |
|---|---|---|
| `AURA_HOST` | `127.0.0.1` | Loopback bind address |
| `AURA_PORT` | `8000` | Port to listen on |
| `AURA_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `AURA_MODEL_NAME` | `qwen3.5:4b` | Default Ollama model |
| `AURA_WHISPER_MODEL_SIZE` | `base.en` | Local Whisper model size (`tiny.en`, `base.en`, etc.) |
| `AURA_WHISPER_DEVICE` | `cpu` | Device for STT (`cpu` or `cuda`) |
| `AURA_WHISPER_COMPUTE_TYPE` | `int8` | Precision quantization (`int8`, `float32`) |
| `AURA_PIPER_MODEL_PATH` | `None` | Path to Piper `.onnx` model (auto-searched if None) |
| `AURA_VOICE_ENABLED` | `true` | Enable/disable voice endpoints |
| `AURA_DATABASE_URL` | `sqlite+aiosqlite:///aura_conversations.db` | Async SQLite connection URI |

## Development & Testing

```powershell
# Activate virtual environment
.venv\Scripts\activate

# Run test suite
pytest -v

# Run with hot reloading
uvicorn aura_agent.main:app --host 127.0.0.1 --port 8000 --reload
```
