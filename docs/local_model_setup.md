# AURA Windows Desktop Release & Local Model Setup Guide

## 1. Overview
AURA is an autonomous, local-first companion and utility engine engineered for Windows. The application operates in an independent, security-isolated Electron shell (`AURA.exe`) and communicates exclusively over localhost (`127.0.0.1`) with local model runtimes.

---

## 2. Windows Desktop Release Architecture

### Electron Security Baseline
* **Context Isolation**: `contextIsolation: true` is strictly enforced.
* **Node Integration Disabled**: `nodeIntegration: false` prevents any renderer script from accessing Node.js runtime APIs.
* **Sandbox Mode**: `sandbox: true` is enabled across all renderer processes.
* **Narrow Preload Bridge**: `window.auraAPI` provides a strictly typed and validated interface for window controls, GPU diagnostics, system health telemetry, persistent settings, and local VRM loading.
* **Content Security Policy (CSP)**:
  ```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;" />
  ```
* **Navigation & Link Security**: In-app navigation to unauthorized URLs is blocked (`will-navigate`); external links open exclusively via the OS default browser (`shell.openExternal`).
* **Zero Browser Dev Server Dependency**: Production builds load pre-compiled static assets directly from `app.asar` via `mainWindow.loadFile('out/renderer/index.html')`.

---

## 3. Local AI Model Setup (Ollama)

AURA utilizes local Ollama model instances for neural reasoning, conversation, and structured tool calling. In accordance with open distribution licenses, AI model weights are not packaged directly into installer binaries.

### Step 1: Install Ollama
Download and run the official Windows installer:
* https://ollama.com/download/windows

Verify that Ollama is running in your Windows system tray or command prompt:
```powershell
ollama --version
```

### Step 2: Pull the Recommended Model
AURA is optimized for `qwen3.5:4b` (or `qwen2.5:7b` for higher reasoning fidelity):
```powershell
ollama pull qwen3.5:4b
```

Alternative compatible models:
* `ollama pull qwen2.5:7b`
* `ollama pull llama3.2:3b`
* `ollama pull mistral:7b`

### Step 3: Configurable Model Directory (Optional)
To relocate Ollama model weights to a custom drive or path:
```powershell
[System.Environment]::SetEnvironmentVariable('OLLAMA_MODELS', 'D:\AI\models', 'User')
```

---

## 4. Local Voice Subsystem Setup

### Speech-to-Text (faster-whisper)
* Operates on-device via CTranslate2.
* Default model: `base.en` (multilingual auto-detection supported).
* Model checkpoints are cached locally in `%USERPROFILE%\.cache\huggingface\hub` or within the configurable `localModelsPath`.

### Text-to-Speech (Piper TTS)
* High-speed, local neural acoustic voice synthesis with phoneme-level viseme generation for 3D character lip sync.
* Available voices:
  * `en_US-libritts-r-medium` (Permissive Open License — Recommended for commercial and daily use)
  * `en_US-lessac-medium` (Research License)

---

## 5. Avatar Assets (VRM Characters)

* AURA supports any standard `.vrm` character model (VRM 0.0 and VRM 1.0).
* **Privacy & Security**: AURA never downloads avatar assets from the internet automatically.
* To use a custom avatar:
  1. Open **Settings** > **Animated Character & VRM Model**.
  2. Click **Browse VRM...** and select your local `.vrm` file (e.g. created in VRoid Studio or Blender).
  3. The model is validated and safely copied into `%APPDATA%\aura-desktop\characters\`.
* To reset to the holographic 3D procedural core, click **Reset**.

---

## 6. Building and Running the Desktop Release

### Development Mode
```powershell
npm --prefix apps/desktop run dev
```

### Typecheck & Test Suite Verification
```powershell
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop test
```

### Packaged Production Release (Independent Windows Executable)
```powershell
# Packages the standalone win-unpacked distribution
npm --prefix apps/desktop run package
```
Output executable:
```
apps/desktop/dist/win-unpacked/AURA.exe
```

### Standalone Windows Installer (NSIS)
```powershell
npm --prefix apps/desktop run dist
```
Output installer:
```
apps/desktop/dist/AURA-Setup-0.1.0.exe
```

---

## 7. Diagnostics & Failure Recovery

| Scenario | Application Behavior | Recovery Action |
| :--- | :--- | :--- |
| **Ollama Offline** | TitleBar & Status show `Ollama: Offline`. | Launch Ollama from Start Menu or run `ollama serve`. |
| **Model Unavailable** | Status shows `Model [name] is not installed`. | Run `ollama pull [name]` or select another installed model in Settings. |
| **Backend Unreachable** | Background supervisor attempts automatic restart; reports detailed status. | Check Python `.venv` dependencies or inspect terminal logs. |
| **Dual-GPU WebGL Loss** | Three-tier context acquisition recovers automatically to standard WebGL2. | Handled transparently by `CharacterController`. |
| **Application Shutdown** | `before-quit` synchronously terminates backend process trees via `taskkill`. | Zero orphaned zombie Python processes. |

