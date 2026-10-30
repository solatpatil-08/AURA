# AURA (Autonomous Utility, Reasoning and Automation)

A professional, local-first, Windows desktop AI assistant built with Electron, React, TypeScript, FastAPI, locally running Ollama models, and on-device speech processing with `faster-whisper` and `Piper TTS`.

---

## Architecture Overview

- **Desktop Shell**: Electron + React + TypeScript + Vite ([`apps/desktop`](apps/desktop/))
- **Local Agent Service**: Python 3.12+ / 3.13 FastAPI Service ([`services/agent`](services/agent/))
- **Inference Engine**: Local Ollama instance running on `127.0.0.1:11434` (default model: `qwen3.5:4b`)
- **Speech Recognition (STT)**: On-device `faster-whisper` via CTranslate2 (English first, configurable model size)
- **Speech Synthesis (TTS)**: Local `Piper TTS` via ONNX Runtime (returns playable WAV audio)
- **Conversation Persistence**: SQLite database stored locally in WAL mode (`aura_conversations.db`)
- **Zero Cloud APIs**: No external cloud AI APIs, no API keys, and strictly local loopback binding (`127.0.0.1`).

---

## Prerequisites

1. **Node.js**: v20+ and `npm`
2. **Python**: 3.12 or 3.13
3. **Ollama**: Installed and running locally
   - Verify Ollama is running:
     ```powershell
     curl http://127.0.0.1:11434/api/tags
     ```
   - Pull the default local model:
     ```powershell
     ollama pull qwen3.5:4b
     ```

---

## Voice Subsystem Setup (Phase 3)

AURA enforces offline privacy: **runtime models are never downloaded automatically**.

To explicitly download and verify your local speech models:

```powershell
cd services/agent

# 1. Download Whisper STT model (e.g. tiny.en or base.en)
.venv\Scripts\python -m aura_agent.scripts.setup_voice --whisper base.en

# 2. Download Piper TTS voice model
.venv\Scripts\python -m aura_agent.scripts.setup_voice --piper en_US-lessac-medium

# 3. Verify the local round-trip pipeline (synthesizes audio & transcribes it back)
.venv\Scripts\python -m aura_agent.scripts.setup_voice --verify
```

> [!IMPORTANT]
> **Voice Model Licensing**: While Piper is MIT licensed, voice models inherit the terms of their training datasets.
> For example, `en_US-lessac` is restricted to non-commercial/personal use. For commercial deployment, choose `en_US-libritts-r` (CC-BY 4.0).
> Consult the [Voice Models & Licensing Guide](docs/voice_licensing_and_models.md) for details.

---

## Getting Started

### 1. Start the FastAPI Agent Backend

Open a terminal and navigate to `services/agent`:

```powershell
cd services/agent
```

If setting up for the first time:
```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

Launch the backend on `127.0.0.1:8000`:
```powershell
.venv\Scripts\python -m uvicorn aura_agent.main:app --host 127.0.0.1 --port 8000 --reload
```

Backend Health Check:
```powershell
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/system/status
curl http://127.0.0.1:8000/api/voice/status
```

---

### 2. Start the Desktop Application

Open a second terminal and navigate to `apps/desktop`:

```powershell
cd apps/desktop
```

If setting up for the first time:
```powershell
npm install
```

Launch the desktop application in development mode:
```powershell
npm run dev
```

### Voice Controls in the Desktop App
- **Push-to-Talk (PTT)**: Click the microphone button in the chat area to begin speaking. Click again or press Enter to transcribe and send, or press Esc / Cancel to discard.
- **Microphone Privacy**: Microphone access is requested only upon direct user interaction and is immediately released when recording ends.
- **Spoken Responses**: Toggle voice output on/off in the chat footer or Settings screen.
- **Volume & Mute**: Configure speech playback volume (0% to 100%) in Settings.

---

## Running Verification & Tests

### Backend Tests (pytest)
```powershell
cd services/agent
.venv\Scripts\pytest -v
```

### Desktop Checks (Typecheck, Lint, Test, Production Build)
```powershell
cd apps/desktop
npm run lint          # ESLint (0 errors, 0 warnings)
npm run typecheck     # TypeScript compiler check
npm test              # Vitest component test suite (27 passing tests)
npm run build         # Production Vite bundling
```

---

## Packaging & Installer (Release Engineering)

AURA utilizes `electron-builder` to package standalone Windows executables and full NSIS installers without requiring external paid cloud APIs.

### 1. Build Portable Unpacked Directory
```powershell
cd apps/desktop
npm run package
```
- Generates the self-contained Windows application at:
  `apps/desktop/dist/win-unpacked/AURA.exe`

### 2. Generate Full Windows NSIS Setup Installer
```powershell
cd apps/desktop
npm run dist
```
- Produces the standard Windows setup wizard executable in `apps/desktop/dist/`.

---

## Documentation Library

- [Installation Guide](docs/installation.md) — Comprehensive prerequisite and setup instructions
- [Developer Guide](docs/development.md) — Architecture invariants, tool creation, and coding standards
- [Troubleshooting Guide](docs/troubleshooting.md) — Diagnostic remedies for Ollama, voice, and network issues
- [Third-Party Notices & License Register](docs/licenses.md) — Dependency and model licenses
- [Known Limitations](docs/limitations.md) — Hardware, anti-bot, and security constraints
- [System Architecture](docs/architecture.md) — Two-process runtime and lifecycle architecture
- [Security Architecture & Threat Model](docs/security.md) — PathJail, Origin validation, and gatekeeping
- [Task Orchestration Spec](docs/tasks.md) — Multi-step task planner, executor, and circuit breakers
- [Persistent Local Memory Spec](docs/memory.md) — SQLite structured memory with secret rejection
- [Browser Research Spec](docs/browser_research.md) — Isolated Playwright automation and synthesis
- [Character & VRM Models](docs/character_and_vrm_models.md) — Three.js avatar rendering & licensing
- [Voice Licensing & Models](docs/voice_licensing_and_models.md) — Speech recognition and TTS setup
- [Roadmap & Milestones](docs/roadmap.md) — Phased implementation log
