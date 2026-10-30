# AURA Troubleshooting and Diagnostics Guide

This document provides systematic diagnostics and remediation procedures for common errors encountered during local execution of the AURA assistant.

---

## 1. Local AI Model & Ollama Issues

### Symptom: `Cannot connect to local Ollama on http://127.0.0.1:11434`
- **Cause**: The Ollama daemon is not running or is blocked by local firewall policies.
- **Diagnostics**:
  ```powershell
  # Verify port 11434 is listening
  Get-NetTCPConnection -LocalPort 11434 -ErrorAction SilentlyContinue
  # Test direct HTTP reachability
  curl.exe http://127.0.0.1:11434/api/tags
  ```
- **Remediation**:
  1. Start Ollama from the start menu or run `ollama serve` in a terminal.
  2. Verify that `AURA_OLLAMA_BASE_URL` in `.env` matches `http://127.0.0.1:11434`.

---

### Symptom: `Model qwen3.5:4b is not installed in local Ollama`
- **Cause**: The default language model has not been pulled to the local model store.
- **Diagnostics**:
  ```powershell
  ollama list
  ```
- **Remediation**:
  ```powershell
  ollama pull qwen3.5:4b
  ```
  *Alternative low-memory model (for machines with < 8GB RAM)*:
  ```powershell
  ollama pull llama3.2:1b
  # Then update AURA_MODEL_NAME=llama3.2:1b in services/agent/.env or Settings UI
  ```

---

## 2. Voice Subsystem Issues

### Symptom: `faster-whisper model base.en failed to load`
- **Cause**: Missing HuggingFace cache or unsupported compute type for local CPU/GPU.
- **Diagnostics**:
  Review `services/agent/aura_conversations.db` or backend logs for `FasterWhisperSTT` initialization exceptions.
- **Remediation**:
  1. Ensure network connectivity during the initial model fetch, or manually place the model under `models/whisper/base.en`.
  2. If running on a CPU without AVX2, update `.env`:
     ```env
     AURA_WHISPER_DEVICE=cpu
     AURA_WHISPER_COMPUTE_TYPE=int8
     ```
  3. If running on NVIDIA GPU, verify CUDA 12 and cuBLAS DLLs (`cublas64_12.dll`) are present on `PATH`.

---

### Symptom: `Piper TTS voice model missing or silent output`
- **Cause**: No ONNX voice checkpoint configured, or missing paired JSON config (`.onnx.json`).
- **Diagnostics**:
  Check `GET /api/voice/status` -> `tts.available`. If `false`, inspect `tts.error`.
- **Remediation**:
  1. Download an approved permissive voice model (e.g. `en_US-lessac-medium.onnx` and `en_US-lessac-medium.onnx.json`).
  2. Place files into `services/agent/models/piper/` or `models/piper/`.
  3. Set paths in `services/agent/.env`:
     ```env
     AURA_PIPER_MODEL_PATH=C:\Projects\AURA\models\piper\en_US-lessac-medium.onnx
     AURA_PIPER_CONFIG_PATH=C:\Projects\AURA\models\piper\en_US-lessac-medium.onnx.json
     ```

---

## 3. 3D Character & VRM Rendering

### Symptom: 3D character area shows abstract procedural rings instead of custom avatar
- **Cause**: This is the expected, safe fallback when no VRM file path is configured in Settings or when the selected file is invalid.
- **Diagnostics**:
  Open DevTools (`Ctrl+Shift+I`) and look for `[CharacterCanvas]` or `[CharacterController]` warnings.
- **Remediation**:
  1. Go to **Settings** -> **Avatar Configuration**.
  2. Click **Browse Local Model** and select a valid `.vrm` file.
  3. Ensure the file size does not exceed the **200 MB** security limit.
  4. Ensure the VRM complies with standard humanoid bone naming conventions.

---

## 4. Controlled Tool Execution & Workspace Safety

### Symptom: `Access Denied: Path is outside permitted workspace`
- **Cause**: PathJail security sandbox blocked access to a directory outside `AURA_WORKSPACE_ROOT`.
- **Diagnostics**:
  Check `services/agent/aura_conversations.db` -> table `tool_audit_logs`.
- **Remediation**:
  1. AURA is strictly confined to its configured workspace directory.
  2. If you need AURA to access another project directory, update `AURA_WORKSPACE_ROOT` in `services/agent/.env`.
  3. Never set `AURA_WORKSPACE_ROOT` to root drives (`C:\`) or system directories (`C:\Windows`, `C:\Users\<user>`).

---

## 5. Browser Automation (Playwright)

### Symptom: `Executable doesn't exist at ... chromium`
- **Cause**: Playwright browser binaries were not installed after package installation.
- **Diagnostics**:
  Run in `services/agent`:
  ```powershell
  .venv\Scripts\playwright install chromium
  ```
- **Remediation**:
  Install the isolated Chromium browser build via the command above.

---

## 6. Network Security & HTTP 403 Forbidden

### Symptom: `HTTP 403 Forbidden: Untrusted origin`
- **Cause**: Cross-Site Localhost Hijacking defense blocked a request because the `Origin` header was from an unapproved web origin.
- **Diagnostics**:
  Inspect request headers. If accessing from a custom port or preview server, add the origin to `AURA_ALLOWED_CORS_ORIGINS` in `config.py` or `.env`.
- **Default Allowed Origins**:
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
  - Packaged desktop origins (`file://`, `null`)

---

## 7. Process Lifecycle & Port Collisions

### Symptom: `Error: [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000)`
- **Cause**: An orphaned Uvicorn backend process from a previous session is still holding port 8000.
- **Remediation**:
  ```powershell
  # Find PID using port 8000
  $conn = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
  if ($conn) {
      Stop-Process -Id $conn.OwningProcess -Force
  }
  ```
