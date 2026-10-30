# AURA Complete Installation and Setup Guide

This guide walks through configuring the AURA desktop assistant and local agent backend from scratch on Windows without relying on paid or remote AI cloud APIs.

---

## 1. Prerequisites

Before installing AURA, verify that the following system tools are installed:

1. **Operating System**: Windows 10 or 11 (64-bit).
2. **Node.js**: Version `20.x` or later (with `npm`).
   - Verify: `node -v` and `npm -v`.
3. **Python**: Version `3.11` or `3.12` (64-bit).
   - Verify: `python --version`.
4. **Ollama**: Local AI inference engine.
   - Download: [ollama.com/download](https://ollama.com/download).
   - Verify: `ollama --version`.

---

## 2. Step 1: Download Local AI Models

AURA is entirely local-first and does not require API keys or paid accounts.

### 1. Start Ollama and Download Default LLM
Open PowerShell and run:
```powershell
ollama pull qwen3.5:4b
```
*(Optional alternative for low-RAM systems under 8GB)*:
```powershell
ollama pull llama3.2:1b
```

Verify that the model is loaded in your local repository:
```powershell
ollama list
```

---

## 3. Step 2: Configure the Python Backend Service

Navigate to `services/agent`:
```powershell
cd C:\Projects\AURA\services\agent
```

### 1. Create and Activate Virtual Environment
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install Required Python Dependencies
```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 3. Install Playwright Browser Binaries
AURA's internet research tools use an isolated Playwright Chromium instance:
```powershell
playwright install chromium
```

### 4. Setup Local Voice Models (Speech & TTS)
1. **Speech Recognition (faster-whisper)**:
   - The default model `base.en` downloads automatically on initial invocation or can be pre-cached into `models/whisper/base.en`.
2. **Text-to-Speech (Piper)**:
   - Download the permissive Piper ONNX voice and config from the [Piper Voice Archive](https://github.com/rhasspy/piper/releases):
     - `en_US-lessac-medium.onnx`
     - `en_US-lessac-medium.onnx.json`
   - Place them in `C:\Projects\AURA\models\piper\`.
   - Set environment variables in `services/agent/.env`:
     ```env
     AURA_PIPER_MODEL_PATH=C:\Projects\AURA\models\piper\en_US-lessac-medium.onnx
     AURA_PIPER_CONFIG_PATH=C:\Projects\AURA\models\piper\en_US-lessac-medium.onnx.json
     ```

---

## 4. Step 3: Install & Build Desktop Application

Navigate to `apps/desktop`:
```powershell
cd C:\Projects\AURA\apps\desktop
```

### 1. Install Node Dependencies
```powershell
npm install
```

### 2. Verify Code Quality and Test Suite
```powershell
npm run lint
npm run typecheck
npm run test
```

### 3. Build Production Renderer and Main Bundles
```powershell
npm run build
```

---

## 5. Step 4: Packaging and Launching AURA

### Development Mode Launch
For development with hot-reloading:
1. **Start Backend**:
   ```powershell
   cd C:\Projects\AURA\services\agent
   .\.venv\Scripts\python -m uvicorn aura_agent.main:app --host 127.0.0.1 --port 8000 --reload
   ```
2. **Start Desktop Client**:
   ```powershell
   cd C:\Projects\AURA\apps\desktop
   npm run dev
   ```

### Production Installer & Unpacked Binary
To package the standalone Windows binary using `electron-builder`:
```powershell
cd C:\Projects\AURA\apps\desktop
npm run package
```
- The unpacked executable will be located at:
  `C:\Projects\AURA\apps\desktop\dist\win-unpacked\AURA.exe`

To build the full NSIS Windows Installer (`.exe` setup):
```powershell
npm run dist
```
- The installer executable will be generated in `C:\Projects\AURA\apps\desktop\dist\`.
