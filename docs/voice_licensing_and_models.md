# AURA Voice Models & License Verification Guide

This document defines the architectural guidelines, storage layout, and licensing verification protocol for local speech processing in AURA.

---

## 1. Core Principles

1. **Strict Offline Privacy**:
   No speech samples, microphone streams, or generated audio files are ever uploaded to cloud services or remote APIs.
2. **Deterministic Model Provisioning**:
   The runtime application **never downloads models automatically**. All models must exist locally on disk before speech features activate. If models are missing, the system gracefully reports their absence without failing or attempting background downloads.
3. **Audited Dataset Licensing**:
   Because speech synthesis models inherit restrictions from their training datasets, every voice model must undergo license verification prior to deployment.

---

## 2. Speech Recognition (faster-whisper)

AURA utilizes `faster-whisper`, a re-implementation of OpenAI's Whisper model powered by CTranslate2.

### Supported Model Sizes
| Model Size | Parameters | Disk Space | Relative Speed | Recommended Use Case |
|---|---|---|---|---|
| `tiny.en` | 39 M | ~75 MB | ~32x | Fast testing / Low-power devices |
| `base.en` | 74 M | ~140 MB | ~16x | **Default AURA configuration** |
| `small.en` | 244 M | ~460 MB | ~6x | High-accuracy technical dictation |
| `medium.en` | 769 M | ~1.5 GB | ~2x | Production noisy-room environments |

### Licensing
- **OpenAI Whisper Weights**: MIT License.
- **faster-whisper Code**: MIT License.
- **CTranslate2 Engine**: Apache 2.0 License.

### Directory Layout
Local Whisper models are stored in:
```
c:\Projects\AURA\models\whisper\<model-size>\
  ├── model.bin
  ├── config.json
  └── vocabulary.txt
```

---

## 3. Text-to-Speech (Piper TTS)

AURA uses Piper, a fast, local neural text-to-speech system running on ONNX Runtime.

### The Voice Licensing Verification Protocol

> [!WARNING]
> While the Piper codebase is licensed under the permissive **MIT License**, **each voice model carries its own specific dataset and training license**.

#### A. Lessac Voices (e.g., `en_US-lessac-medium`, `en_US-lessac-high`)
- **Dataset Origin**: Derived from the Blizzard Challenge 2013 Lessac speech dataset.
- **License**: **Research and Non-Commercial / Personal Use Only**.
- **Inherited Restrictions**: Voice models fine-tuned from the Lessac checkpoint inherit this non-commercial restriction.
- **Permitted Use**: Personal desktop companions, internal developer evaluations, home automation.

#### B. Permissive & Commercial-Friendly Voices
For production or commercial deployment, select voices trained from scratch on unrestricted corpora:
- **LibriTTS Voices** (e.g., `en_US-libritts-r`): Creative Commons Attribution 4.0 International (**CC-BY 4.0**).
- **Public Domain / CC0 Voices** (e.g., `en_US-bryce-medium`, `en_US-norman-medium`).

### Directory Layout
Local Piper voice models are stored in:
```
c:\Projects\AURA\models\piper\
  ├── <voice-name>.onnx        (ONNX neural weights)
  └── <voice-name>.onnx.json   (Phoneme map and synthesis parameters)
```

---

## 4. Manual Model Installation & Verification

To install models explicitly (without runtime downloads):

### Step 1: Install Models via Setup Script
From the backend virtual environment:

```powershell
cd c:\Projects\AURA\services\agent

# Download base.en Whisper model
.venv\Scripts\python -m aura_agent.scripts.setup_voice --whisper base.en

# Download Piper voice model
.venv\Scripts\python -m aura_agent.scripts.setup_voice --piper en_US-lessac-medium
```

### Step 2: Self-Verification
Execute the local round-trip self-test (synthesizes audio with Piper and transcribes it with Whisper):

```powershell
.venv\Scripts\python -m aura_agent.scripts.setup_voice --verify
```

### Step 3: Runtime Configuration
Configure your custom model paths in `.env` or system environment variables:

```ini
# AURA Voice Configuration
AURA_VOICE_ENABLED=true
AURA_WHISPER_MODEL_SIZE=base.en
AURA_WHISPER_DEVICE=cpu
AURA_WHISPER_COMPUTE_TYPE=int8
AURA_PIPER_MODEL_PATH=C:\Projects\AURA\models\piper\en_US-lessac-medium.onnx
```
