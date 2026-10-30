# AURA Project Roadmap & Implementation Strategy

## 1. Roadmap Philosophy & Phasing Principles

To deliver a stable, secure, and production-grade local AI assistant, development is structured into **incremental, decoupled milestones**. Each milestone satisfies strict quality criteria and is independently testable before proceeding to downstream capabilities.

```mermaid
gantt
    title AURA Incremental Delivery Schedule
    dateFormat  X
    axisFormat  M%s

    section Foundation
    M0: Setup & Tooling             :active, m0, 0, 1
    M1: Process Lifecycle & IPC     :m1, after m0, 2
    
    section Core Intelligence
    M2: Ollama & Local Persistence  :m2, after m1, 3
    M3: 3D VRM Avatar Canvas        :m3, after m2, 4
    
    section Voice & Interaction
    M4: Speech Pipeline (STT/TTS)   :m4, after m3, 5
    
    section Automation & Control
    M5: Tool Registry & Review Gate :m5, after m4, 6
    M6: Scoped Automation Modules   :m6, after m5, 7
    
    section Autonomy & Production
    M7: Memory & Autonomous Loops   :m7, after m6, 8
    M8: Hardening & Packaging       :m8, after m7, 9
```

---

## 2. Milestone Breakdown

### Milestone 0: Architecture, Repository Setup & Tooling
* **Objective**: Establish the monorepo structure, typing systems, linting rules, and developer tooling.
* **Deliverables**:
  * Root monorepo configuration with `apps/desktop` (Vite, React 18, TypeScript) and `services/backend` (Python 3.11+, Poetry/PDM).
  * ESLint, Prettier, TypeScript `tsconfig.json` with strict type checking enabled.
  * Python `ruff`, `mypy`, and `pytest` configurations.
  * GitHub Actions / pre-commit scripts for local verification.
* **Definition of Done (DoD)**:
  * Both TypeScript and Python linting, formatting, and dummy tests pass with zero warnings in clean environments.

---

### Milestone 1: Process Lifecycle, Supervisor & Secure IPC
* **Objective**: Create the Electron host that securely supervises the Python backend process and orchestrates inter-process communication.
* **Deliverables**:
  * Electron Main process supervisor:
    * Launches Python backend child process.
    * Generates a 256-bit cryptographically secure ephemeral token and injects it into Python via standard input/secure environment variable.
    * Performs poll loop against `/health` until backend signals readiness.
    * Implements graceful shutdown (SIGTERM/SIGINT) handling on window exit.
  * ContextBridge Preload layer exposing minimal `auraAPI`.
  * FastAPI server bootstrap validating Bearer tokens on all requests.
* **Definition of Done (DoD)**:
  * Electron launches, starts Python on a dynamic localhost port, validates connection via token handshake, displays backend health in React UI, and cleanly terminates both processes on close.

---

### Milestone 2: Local AI Engine (Ollama) & Local Persistence
* **Objective**: Connect the Python backend to the local Ollama daemon and implement SQLite chat storage.
* **Deliverables**:
  * Async Ollama client capable of listing models, validating the presence of `qwen3.5:4b`, and handling streaming chat completions.
  * Fallback notification in UI if Ollama is not installed or model is absent, with clear pull instructions (`ollama run qwen3.5:4b`).
  * SQLite database with SQLAlchemy/Alembic migrations:
    * `sessions` table (conversation threads).
    * `messages` table (roles, text, token counts, timestamps).
  * Streaming chat interface in React with Markdown and syntax-highlighted code rendering.
* **Definition of Done (DoD)**:
  * User can type a prompt in the desktop chat, receive tokens streamed in real time from local `qwen3.5:4b`, and view preserved conversation history across application restarts without any internet connection.

---

### Milestone 3: 3D Avatar Rendering Engine (Three.js + Three-VRM)
* **Objective**: Host and render a performant 3D VRM character inside the React client.
* **Deliverables**:
  * WebGL Canvas integration inside React using Three.js and `@pixiv/three-vrm`.
  * Asset loader supporting local `.vrm` character models with validation for license and polygon complexity.
  * Baseline animation engine:
    * Natural idle breathing animation (bone manipulation).
    * Random periodic eye-blinking using VRM blendshape proxies (`blink`, `blinkLeft`, `blinkRight`).
    * Look-at tracking following user mouse cursor or window center.
  * Window resizing and hardware-accelerated rendering optimizations.
* **Definition of Done (DoD)**:
  * A local VRM avatar displays at stable 60 FPS in the desktop client, executes natural idle animations, and provides an exported API for programmatic facial expression changes.

---

### Milestone 4: Local Voice Pipeline (STT & TTS with Lip-Sync)
* **Objective**: Enable speech input via Push-to-Talk (PTT) and expressive local speech output synchronized with the VRM avatar.
* **Deliverables**:
  * **Audio Capture**: React Push-to-Talk hook capturing 16kHz mono PCM via Web Audio API.
  * **Speech-to-Text**: Python `faster-whisper` integration (utilizing `base.en` or `small.en` quantized via CTranslate2).
  * **Text-to-Speech**: Python `Piper TTS` integration generating low-latency speech audio and phoneme boundary markers.
  * **Lip-Sync Sync**: WebSocket stream transmitting audio chunks with corresponding phoneme timestamps to the renderer, driving VRM vowel blendshapes (`aa`, `ih`, `ou`, `ee`, `oh`).
* **Definition of Done (DoD)**:
  * Holding PTT transcribes spoken instructions locally with <800ms latency. The avatar responds audibly using Piper TTS while mouth movements accurately match the spoken syllables.

---

### Milestone 5: Typed Tool Registry & Safety Review Architecture
* **Objective**: Establish the foundation for safe computer control with strict human oversight.
* **Deliverables**:
  * Pydantic-based `BaseTool` class generating strict JSON Schema descriptions for Ollama function calling.
  * Tool Registry for dynamic registration, validation, and dispatch.
  * Permission Evaluation Gatekeeper:
    * Categorization of tools into `SAFE_AUTO`, `REQUIRES_REVIEW`, and `DENIED`.
  * Human-in-the-Loop Review UI:
    * Intercepts tool executions marked `REQUIRES_REVIEW`.
    * Pops up a modal in the Electron client detailing the tool, arguments, target file paths, and diff preview.
    * Allows user to "Approve Once", "Reject", or provide guidance feedback.
  * SQLite Audit Log recording all tool attempts, user approvals, and exit states.
* **Definition of Done (DoD)**:
  * If the LLM proposes an action flagged for review, execution blocks completely until the user explicitly clicks "Approve" in the desktop UI. All attempts are permanently audited in SQLite.

---

### Milestone 6: Core Automation Modules
* **Objective**: Implement secure, scoped automation primitives.
* **Deliverables**:
  * **Scoped File Manager**:
    * Canonical path enforcement restricting reads and writes to user-designated workspace directories.
    * Directory tree traversal, file reading, file writing (unified diff generation), and deletion with trash fallback.
  * **Windows App Launcher**:
    * Strictly allowlisted registry of executable targets (e.g., Notepad, VS Code, Calculator).
    * Launches using explicit argument arrays; zero execution through `cmd.exe` or `powershell.exe`.
  * **Isolated Web Search**:
    * Local HTML parsing / API querying of DuckDuckGo Lite or local SearXNG instance.
    * Operates strictly as an explicit tool requiring network access; fails gracefully when offline.
  * **Playwright Browser Automation**:
    * Headless/headed Chromium controller running in an isolated browser context.
    * Navigates approved URLs, captures page text, and extracts structured content.
* **Definition of Done (DoD)**:
  * The agent can open a project directory, inspect files, draft updates with review diffs, search the web when requested, and open approved applications without triggering security warnings.

---

### Milestone 7: Structured Memory & Multi-Step Reasoning
* **Objective**: Enable persistent recall of user preferences and multi-turn autonomous problem solving.
* **Deliverables**:
  * Episodic memory extraction pipeline: evaluates completed tasks and extracts user facts (e.g., preferred coding conventions, project paths) into SQLite.
  * Local semantic vector index using `sqlite-vec` or local ONNX sentence transformer embeddings.
  * Multi-step reasoning controller:
    * ReAct loop with step limits (default: 8 steps max).
    * Loop detection heuristic (preventing repetitive failed tool invocations).
    * Dynamic context window management with automatic older-turn summarization.
* **Definition of Done (DoD)**:
  * The agent can execute a 3-step task (e.g., "Find the latest report in workspace, summarize its contents, and save the summary to notes.txt"), correctly recalling information across separate sessions.

---

### Milestone 8: Hardening, Packaging & Release Preparation
* **Objective**: Prepare production distribution binaries and enforce runtime hardening.
* **Deliverables**:
  * Python backend bundling using PyInstaller or Nuitka into a standalone executable.
  * Electron client packaging via `electron-builder` producing Windows NSIS installer or portable `.exe`.
  * Comprehensive end-to-end testing suite validating offline operation, token security, and tool gatekeeping.
  * Documentation of all third-party software, models, and licenses.
* **Definition of Done (DoD)**:
  * A single installer installs AURA on a fresh Windows 10/11 machine. The application boots, connects to local Ollama, and functions fully offline.

---

## 3. Comprehensive Testing Strategy

| Test Level | Technology | Scope | Target Coverage |
| :--- | :--- | :--- | :--- |
| **Backend Unit Tests** | `pytest`, `pytest-asyncio` | Tool validation, path jailing, permission gate logic, Pydantic schemas, Ollama client parsing | >85% logic coverage |
| **Backend Mock Integration** | `pytest`, `httpx` mock | ReAct loop execution using mocked Ollama responses, tool dispatch workflows, SQLite persistence | 100% critical path |
| **Frontend Unit Tests** | `Vitest`, `React Testing Library` | State stores (Zustand), UI components, review modal states, PTT audio state transitions | >80% component coverage |
| **IPC Bridge Tests** | `Vitest` | Mocked Electron `contextBridge`, verifying no leakage of sensitive globals | 100% channel coverage |
| **End-to-End (E2E)** | `Playwright Electron` | Full desktop lifecycle: boot supervisor, render avatar, mock voice input, approve tool, verify file written | Core golden paths |

---

## 4. Key Technical Risks & Mitigation Strategies

### Risk 1: Resource Contention on Consumer GPUs/CPUs
* **Impact**: Running Ollama (`qwen3.5:4b`), `faster-whisper`, `Piper TTS`, and Three.js simultaneously may cause audio stutter or high system latency on non-gaming hardware.
* **Mitigation**:
  * Sequential execution: STT runs first, frees CPU/GPU; LLM generates tokens; TTS synthesizes in chunks.
  * Utilize CTranslate2 CPU quantization (`int8`) for Whisper to preserve GPU VRAM exclusively for Ollama and Three.js.
  * Configure Piper TTS with lightweight low-complexity voices (`en_US-lessac-medium`).

### Risk 2: Hallucination of Tool Calls or Arguments
* **Impact**: Smaller models (like 4B parameters) can occasionally generate malformed JSON or invent non-existent tool names.
* **Mitigation**:
  * Pydantic validation interceptor: If tool arguments fail schema validation, the error message is fed back to the model within the agent loop for immediate self-correction.
  * Strict grammar-based sampling or Ollama structured output mode (`format="json"` or tool calling parameter format).

### Risk 3: Path Traversal and Accidental File Destruction
* **Impact**: The model attempts to write files outside the workspace or delete essential user files.
* **Mitigation**:
  * Strict path jailing: All paths must resolve within explicitly configured workspace directories.
  * Zero permanent deletions in initial versions; deletions move files to the Windows Recycle Bin (`send2trash` library) with mandatory user review.
