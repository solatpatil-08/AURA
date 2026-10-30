# AURA Third-Party Notices and License Register

This document registers all third-party software, libraries, AI models, voice models, and character assets utilized across the AURA application suite, along with their respective license classifications.

---

## 1. Project Licensing
The AURA desktop application and agent services are licensed under the **MIT License**.

---

## 2. Desktop Application Dependencies (`apps/desktop`)

| Package | Version | License | Copyright / Author | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Electron** | `34.2.0` | MIT | OpenJS Foundation | Desktop runtime environment |
| **React** | `18.3.1` | MIT | Meta Platforms, Inc. | UI component rendering |
| **React DOM** | `18.3.1` | MIT | Meta Platforms, Inc. | DOM bindings for React |
| **Three.js** | `0.186.1` | MIT | Ricardo Cabello (mrdoob) | 3D WebGL scene rendering |
| **@pixiv/three-vrm** | `3.5.5` | MIT | Pixiv Inc. | Humanoid VRM avatar loading & animation |
| **Lucide React** | `1.16.0` | ISC | Lucide Contributors | UI iconography |
| **electron-vite** | `6.0.0` | MIT | alex.840411486@gmail.com | Build orchestration for Electron & Vite |
| **electron-builder** | `26.18.0` | MIT | Electron-Builder contributors | Windows installer & binary packaging |
| **Vite** | `6.1.0` | MIT | Evan You & Vite Contributors | Frontend bundler and dev server |
| **TypeScript** | `5.7.3` | Apache 2.0 | Microsoft Corporation | Static type checking |
| **Vitest** | `3.0.5` | MIT | Vitest Team | Unit and component testing framework |

---

## 3. Backend Agent Dependencies (`services/agent`)

| Package | Version | License | Copyright / Author | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **FastAPI** | `>=0.115.0` | MIT | Sebastián Ramírez | Local REST API and streaming server |
| **Uvicorn** | `>=0.34.0` | BSD-3-Clause | Encode OSS Ltd | ASGI web server implementation |
| **Pydantic** | `>=2.10.0` | MIT | Samuel Colvin | Data validation and settings schemas |
| **pydantic-settings**| `>=2.7.0` | MIT | Samuel Colvin | Environment-based configuration |
| **HTTPX** | `>=0.28.0` | BSD-3-Clause | Encode OSS Ltd | Async HTTP client for Ollama API |
| **SQLAlchemy** | `>=2.0.38` | MIT | Michael Bayer | Object-relational mapping and SQLite SQL generation |
| **aiosqlite** | `>=0.21.0` | MIT | John Reese | Async SQLite driver |
| **faster-whisper** | `>=1.2.0` | MIT | Guillaume Klein, SYSTRAN | On-device speech-to-text inference |
| **PyAV (`av`)** | `>=11,<18` | BSD / LGPL | Mike Boers | Audio/video demuxing and format conversion |
| **Piper TTS** | `>=1.8.0` | MIT | Michael Hansen (Rhasspy) | On-device text-to-speech generation |
| **Playwright** | `>=1.40.0` | Apache 2.0 | Microsoft Corporation | Headless browser automation for research |
| **BeautifulSoup4** | `>=4.12.0` | MIT | Leonard Richardson | HTML sanitization and text extraction |
| **pytest** | `>=8.3.0` | MIT | Holger Krekel & Pytest Contributors | Backend testing framework |
| **pytest-asyncio** | `>=0.25.0` | Apache 2.0 | Tin Tvrtković | Async test runner extension |

---

## 4. Local AI and Voice Model Attributions

### Large Language Models (LLMs)
- **Ollama**: MIT License. (Ollama, Inc.)
- **Qwen 2.5 / 3.5 Series** (Default: `qwen3.5:4b`): Apache 2.0 / Tongyi Qianwen License. Permissive for local research, commercial, and personal inference.
- **Llama 3.2 Series** (Alternative: `llama3.2:1b`): Llama 3.2 Community License. Permitted for local inference.

### Speech Recognition Models (STT)
- **faster-whisper (`base.en`)**: Model weights originated from OpenAI Whisper under the MIT License, converted into CTranslate2 format by SYSTRAN under the MIT License.

### Text-to-Speech Voices (TTS)
- **Piper Voice Models** (e.g., `en_US-lessac-medium`):
  - Model weights trained on the Lessac corpus.
  - License: Open Database License (ODbL) or Public Domain (CC0).
  - Attribution: LibriTTS / Lessac research groups.

---

## 5. Character & Avatar Assets
- **AURA Core Distribution**: Ships **zero copyrighted or proprietary 3D character assets**.
- **Procedural Fallback**: A built-in mathematical geometry shader and procedural ring system provides an interactive experience out-of-the-box without requiring external model files.
- **User-Provided VRMs**: Users are responsible for ensuring that custom VRM models loaded through the Settings interface comply with the author's distribution license (e.g., CC-BY, VRoid Studio default licensing, or personal commercial terms).
