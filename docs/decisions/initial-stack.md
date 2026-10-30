# Architectural Decision Records (ADR): Initial Technology Stack

This document records the foundational architectural decisions for **AURA (Autonomous Utility, Reasoning and Automation)**, documenting the rationale, trade-offs, and licensing implications for each component.

---

## ADR-001: Desktop Application Architecture (Electron + React + Vite)

### Status
Accepted

### Context
AURA requires a Windows desktop shell that combines hardware-accelerated 3D graphics (Three.js WebGL canvas), real-time Web Audio processing (push-to-talk audio worklets), responsive UI components for chat and review modals, and secure OS integration.

### Alternatives Considered
1. **Tauri (Rust + Webview)**:
   * *Pros*: Smaller binary size, lower baseline memory footprint.
   * *Cons*: Relies on Windows WebView2. WebView2 can introduce subtle audio worklet inconsistencies, WebGL extension variations across machines, and packaging/coordinating a complex Python AI runtime sidecar is significantly more complex in Rust compared to Electron's battle-tested process supervisor patterns.
2. **PySide6 / PyQt (Python Qt GUI)**:
   * *Pros*: Single runtime language (Python).
   * *Cons*: Poor support for modern WebGL/VRM 3D models. Integrating Three.js and `@pixiv/three-vrm` requires embedded QWebEngineView (which is essentially Chromium anyway), negating memory benefits while complicating frontend developer tooling.
3. **Electron (Node.js + Chromium) with React 18 & Vite**:
   * *Pros*: Guaranteed, deterministic Chromium version with unified WebGL 2.0 and Web Audio Worklet support. Native ecosystem compatibility with `@pixiv/three-vrm`. Mature security isolation primitives (`contextIsolation`, `sandbox`). Vite provides sub-second HMR for frontend rapid iteration.
   * *Cons*: Higher baseline memory footprint (~100–150 MB for the shell).

### Decision
Adopt **Electron + React 18 + TypeScript + Vite**. The guaranteed Chromium environment is essential for stable VRM avatar rendering and low-latency Web Audio processing.

---

## ADR-002: Backend Runtime & Process Architecture (Python FastAPI Sidecar)

### Status
Accepted

### Context
The application must execute local speech-to-text, text-to-speech, reasoning loops, scoped filesystem operations, and process launches. We need to decide whether to run this logic inside Electron (Node.js) or a dedicated Python backend process.

### Alternatives Considered
1. **Pure Node.js Runtime**:
   * *Pros*: Single language across desktop client and backend.
   * *Cons*: High-performance local AI libraries (like `faster-whisper` based on CTranslate2, `Piper TTS`, and advanced tokenizers) are first-class in Python and have incomplete or poorly maintained Node.js native bindings.
2. **Python FastAPI Sidecar**:
   * *Pros*: Direct access to CTranslate2 (`faster-whisper`), ONNX Runtime (`Piper TTS`), Pydantic validation, and the rich Python AI ecosystem. Decouples UI rendering crashes from backend reasoning state.
   * *Cons*: Requires managing a child process lifecycle, inter-process communication, and bundling a Python environment.

### Decision
Use a **Python FastAPI service running as a local sidecar process**. The Electron Main process acts as the supervisor, spawning Python on a dynamic localhost port with an ephemeral shared token.

---

## ADR-003: Local LLM Execution Engine (Ollama)

### Status
Accepted

### Context
AURA must perform local inference without external API keys or cloud dependencies. The inference runtime must handle model quantization, hardware acceleration (NVIDIA CUDA, AMD ROCm, CPU fallback), and structured tool calling.

### Alternatives Considered
1. **Embedded `llama-cpp-python`**:
   * *Pros*: Embedded directly within the Python process.
   * *Cons*: Compiling native C++ extensions across various user GPU setups (CUDA vs Vulkan vs CPU) inside a distributed Python wheel frequently causes installation and compilation failures on end-user machines.
2. **vLLM / TGI**:
   * *Pros*: High throughput.
   * *Cons*: Built for multi-user cloud servers; heavy memory footprint; non-trivial Windows support.
3. **Ollama Service Daemon (`http://127.0.0.1:11434`)**:
   * *Pros*: Industry-standard local model runner with dedicated Windows installers. Handles GPU detection, memory offloading, GGUF model caching, and model pulling automatically. Exposes clean REST API with streaming and native tool-calling support.
   * *Cons*: User must have Ollama installed or bundled as a system prerequisite.

### Decision
Integrate with **Ollama via its local HTTP API (`127.0.0.1:11434`)**. The backend connects asynchronously using `httpx`, targeting configurable models.

---

## ADR-004: Baseline Local Model Selection (`qwen3.5:4b`)

### Status
Accepted

### Context
The assistant must run on consumer-grade hardware (including laptops without discrete GPUs or with 4GB–8GB VRAM) while demonstrating capable reasoning, tool selection, and conversational fluency.

### Rationale
* **Parameter Efficiency**: At ~4 billion parameters with 4-bit quantization (Q4_K_M), the model requires ~2.5 GB to 3.5 GB of VRAM/RAM, leaving sufficient headroom for the OS, Electron, Three.js, and audio engines.
* **Tool Calling & Structured Output**: The Qwen family exhibits best-in-class function calling and JSON formatting adherence among sub-7B models.
* **Configurability**: Model name is parameterized via configuration (`AURA_MODEL_NAME=qwen3.5:4b`), allowing seamless upgrades to larger models (e.g., `qwen2.5:7b` or `qwen2.5-coder`) when hardware allows.

---

## ADR-005: Speech Processing Engines (faster-whisper & Piper TTS)

### Status
Accepted

### Context
Speech interaction must operate entirely on-device with minimal latency and push-to-talk activation.

### Speech-to-Text (STT): `faster-whisper`
* **Selected Technology**: `faster-whisper` (CTranslate2 implementation of OpenAI Whisper).
* **Rationale**: Up to 4x faster than original Whisper with 8-bit quantization; runs efficiently on CPU and GPU; `base.en` or `small.en` models transcribe spoken instructions in under 500ms on modern hardware.

### Text-to-Speech (TTS): `Piper TTS`
* **Selected Technology**: `Piper TTS` (ONNX Runtime based).
* **Rationale**: Extremely low computational overhead (real-time factor < 0.1 on CPU); highly natural voice output; generates raw audio and phoneme length metadata required for lip-sync synchronization with 3D avatars.

---

## ADR-006: 3D Character Avatar Engine (Three.js + @pixiv/three-vrm)

### Status
Accepted

### Context
A visual, animated character is required to make the assistant feel present and responsive.

### Alternatives Considered
1. **Embedding Unity / Godot**:
   * *Pros*: Full game engine features.
   * *Cons*: Massive bundle size (+200MB), complex window embedding, high idle memory usage.
2. **Three.js with `@pixiv/three-vrm`**:
   * *Pros*: Official standard implementation of the VRM specification (GLTF 2.0 extension). Direct JavaScript/TypeScript manipulation of humanoid bones, eye gaze, and blendshapes. Renders directly in an HTML5 WebGL canvas.
   * *Cons*: Requires managing animation loops and shaders manually.

### Decision
Use **Three.js with `@pixiv/three-vrm`** inside a dedicated React component.

---

## ADR-007: Persistence & Local Memory Layer (SQLite via SQLAlchemy)

### Status
Accepted

### Context
The application needs local, robust storage for sessions, messages, audit logs, permissions, and episodic memories without requiring database server setup.

### Decision
Use **SQLite** configured with:
* **WAL Mode (Write-Ahead Logging)**: Enables concurrent reads and non-blocking writes.
* **SQLAlchemy ORM**: Provides clean type-safe schema definitions and automated Alembic migrations.
* **Local Semantic Memory**: Use local ONNX embeddings (`all-MiniLM-L6-v2`) and cosine distance indexing (via `sqlite-vec` or an embedded vector store) for retrieving relevant episodic context.

---

## 5. Software, Model & Voice Licenses Inventory

All third-party tools, models, and libraries in AURA must have open, permissible licenses compatible with private, local deployment:

| Component | Repository / Source | License | Permissible Use Notes |
| :--- | :--- | :--- | :--- |
| **Electron** | `electron/electron` | **MIT** | Free commercial and personal use. |
| **React** | `facebook/react` | **MIT** | Free commercial and personal use. |
| **Three.js** | `mrdoob/three.js` | **MIT** | Free commercial and personal use. |
| **@pixiv/three-vrm** | `pixiv/three-vrm` | **MIT** | Official VRM rendering library. |
| **FastAPI** | `tiangolo/fastapi` | **MIT** | High-performance Python async framework. |
| **Pydantic** | `pydantic/pydantic` | **MIT** | Data validation using Python type annotations. |
| **faster-whisper** | `SYSTRAN/faster-whisper` | **MIT** | CTranslate2-based Whisper implementation. |
| **CTranslate2** | `OpenNMT/CTranslate2` | **MIT** | Fast inference engine for Transformer models. |
| **Whisper Models** | `openai/whisper` | **MIT** | Model weights published under MIT license. |
| **Piper TTS** | `rhasspy/piper` | **MIT** | Fast local neural text-to-speech. |
| **Piper Voice Models** | `rhasspy/piper-voices` | **Various (MIT, CC0, Public Domain)** | Specific voice models must be selected from MIT or CC0 subsets (e.g., `en_US-lessac`). |
| **Ollama** | `ollama/ollama` | **MIT** | Local model runner. |
| **Qwen Models** | `Qwen/Qwen2.5` | **Apache 2.0 / Qwen License** | Qwen 2.5 series weights (including 4B/7B/14B) are published under Apache 2.0 or open commercial licenses allowing local, private execution. |
| **Playwright** | `microsoft/playwright` | **Apache 2.0** | Reliable end-to-end browser automation. |
| **SQLite** | `sqlite/sqlite` | **Public Domain** | Dedicated zero-configuration embedded database. |
| **SQLAlchemy** | `sqlalchemy/sqlalchemy` | **MIT** | Python SQL toolkit and ORM. |
| **VRM Base Model** | Sample VRM assets | **CC0 / VRoid License** | Any distributed base character avatar must be verified for CC0 or unrestricted personal/commercial modification permissions. |
