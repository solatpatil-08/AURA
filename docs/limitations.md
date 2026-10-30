# AURA Known Limitations and Architectural Constraints

This document details known limitations, hardware constraints, security boundaries, and operational considerations of the AURA local AI assistant system.

---

## 1. Hardware & Compute Constraints

### Memory & Processing Capacity
- **Language Model Inference**:
  - The default model (`qwen3.5:4b`) requires approximately **4.5 GB of free RAM** (or VRAM if GPU offloading is active in Ollama).
  - Machines with **8 GB RAM or less** may experience system slowdowns if other heavy applications are open simultaneously. For low-memory configurations, configure `llama3.2:1b` in `AURA_MODEL_NAME`.
- **Concurrent CPU Load**:
  - Simultaneous execution of STT transcription (`faster-whisper`), LLM reasoning (`Ollama`), and TTS generation (`Piper`) on systems with fewer than 4 CPU cores may result in temporary audio synthesis latency.

---

## 2. Browser Automation & Internet Research

### Anti-Bot & Captcha Boundaries
- **No CAPTCHA Bypassing**:
  - By design, AURA's managed browser profile does not attempt to bypass CAPTCHAs, Cloudflare Turnstiles, or anti-bot challenges. If a site presents a CAPTCHA, AURA flags the page as protected and falls back to alternate search results.
- **Content Truncation**:
  - Page extractions are strictly limited to **12,000 characters** (`browser_max_content_chars`) before feeding into the local LLM. This prevents overflowing the local model's attention context window.
- **SSRF & Network Defense**:
  - Private intranet IPs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), cloud metadata services (`169.254.169.254`), and loopback IPs (`127.0.0.1`) are blocked from research requests to prevent Server-Side Request Forgery.

---

## 3. Tool Sandboxing & File Safety

### Workspace Confinement
- **Strict PathJail**:
  - AURA is locked inside the directory specified by `AURA_WORKSPACE_ROOT` (e.g. `C:\Projects\AURA`). Any operation attempting to read, list, search, or write outside this boundary is rejected with `AccessDenied`.
- **System File Protection**:
  - Windows system folders (`C:\Windows`, `System32`, `Program Files`, User AppData roots) and critical files (`.env`, `id_rsa`, certificates, SSH keys) are unconditionally denied, even if contained within the workspace root.
- **File Read Size**:
  - Files larger than **5 MB** cannot be read into memory by the text tool to prevent agent process memory exhaustion.

---

## 4. Multi-Step Task Orchestration

### Execution Safeguards
- **Maximum Step Limit**:
  - Multi-step tasks are capped at **15 steps** (`task_max_steps`). Tasks exceeding this limit fail during plan validation.
- **Total Tool Calls Cap**:
  - An absolute upper limit of **10 tool invocations** (`task_max_total_tool_calls`) is enforced per task execution to prevent runaway automated loops.
- **Side Effect Idempotency**:
  - Consequential actions that modify external state (writing notes, creating folders, opening apps) are flagged with `side_effect_occurred=True`. If the step fails subsequently, AURA will **never automatically retry** the tool call to prevent duplicate side effects.

---

## 5. Voice Interaction Limitations

### Push-to-Talk vs. Wake Word
- AURA uses intentional **Push-to-Talk (PTT)** interaction. Wake-word detection (e.g., "Hey Aura") is deliberately not implemented to guarantee total privacy and eliminate continuous background audio capture.
- **Audio Output Latency**:
  - Piper synthesizes audio on a per-response basis and streams the resulting WAV blob to the desktop renderer. On low-power CPUs, there may be a 200–500ms delay between text completion and audio playback start.

---

## 6. Distribution & Packaging

- **Operating System Support**:
  - Windows x64 is the primary and fully verified platform target with configured NSIS installers and process management scripts.
  - Linux and macOS targets require environment-specific packaging configurations and notarization setups not bundled in the initial release.
- **Code Signing**:
  - The default installer build is unsigned. Windows SmartScreen may present an unknown publisher warning upon first launch until an EV/OV code-signing certificate is integrated into the release pipeline.
