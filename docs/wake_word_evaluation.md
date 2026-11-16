# AURA Advanced Voice Architecture: openWakeWord Technical Evaluation

## 1. Executive Summary

As part of the **AURA Advanced Voice Experience** initiative, this document provides an engineering evaluation of **openWakeWord** as the on-device, zero-cloud wake-word detection engine for AURA.

AURA adheres to strict local-first and privacy-by-design principles:
- **Zero Cloud APIs**: All speech recognition, wake-word detection, and speech synthesis execute 100% on-device.
- **Push-to-Talk as Safe Default**: The microphone is never continuously active by default. Continuous capture is an explicit, opt-in feature.
- **No Automatic Model Downloads**: No neural weights or assets are downloaded in the background without explicit user authorization.
- **Ephemeral Processing**: In-memory ring buffers are immediately cleared without writing raw user audio to disk.

---

## 2. Technology & Architecture Evaluation: openWakeWord

### 2.1 Overview
`openWakeWord` is an open-source, permissive Apache 2.0-licensed wake-word detection framework designed specifically for real-time edge devices and desktop environments.

- **Author**: David Scripka
- **License**: Apache 2.0
- **Underlying Runtime**: ONNX Runtime (CPU / DirectML / CUDA)
- **Audio Sample Rate**: 16,000 Hz, 16-bit mono PCM
- **Input Chunk Size**: 80 ms (1,280 samples) or 100 ms

### 2.2 Neural Architecture & Performance Metrics

| Metric | openWakeWord Specification | AURA Desktop Impact |
|---|---|---|
| **Inference Engine** | ONNX Runtime (CPU INT8 / FP32) | Native integration via Python backend or Node/Electron |
| **Model Footprint** | ~3.5 MB – 6.5 MB per model | Negligible disk and RAM footprint (< 25 MB RAM total) |
| **CPU Utilization** | ~1.2% – 2.8% on modern 4-core+ CPU | Leaves > 97% CPU available for local LLM inference |
| **Latency** | < 15 ms inference per 80 ms audio chunk | Sub-perceptual wake latency |
| **False Positive Rate** | ~0.2 – 0.5 per 24 hours under normal room conditions | High rejection of ambient conversation |
| **Network Requirements** | **Zero / Completely Offline** | Fully compliant with AURA sandbox & privacy guardrails |

### 2.3 Evaluation of Pre-Trained Models

openWakeWord provides several validated pre-trained open checkpoints:

1. **`hey_jarvis`** (Recommended Default for AURA Companion):
   - *Characteristics*: Multi-speaker synthetic dataset with diverse acoustic accents.
   - *Accuracy*: High recall (> 94%) in typical desktop room acoustics.
   - *Compatibility*: Ideal for general desktop companion persona.

2. **`alexa`**:
   - *Characteristics*: Benchmark open model trained on large synthetic dataset.
   - *Accuracy*: Highest precision with exceptionally low false positive rate.
   - *Suitability*: Excellent baseline benchmark.

3. **`hey_mycroft`**:
   - *Characteristics*: Community-driven open voice model.
   - *Accuracy*: Reliable performance in near-field desktop environments.

4. **Custom `hey_aura` (Future Training Pipeline)**:
   - openWakeWord supports generating synthetic training corpora using Piper TTS voices.
   - A custom `hey_aura` checkpoint can be synthesized locally using Piper multi-speaker voices, avoiding any external cloud training APIs.

---

## 3. Privacy, Security & Resource Governance

### 3.1 Non-Intrusive Inactive Default
- AURA defaults to **Push-to-Talk (PTT)** mode.
- The browser/Electron microphone stream is inactive and uninitialized until the user clicks the microphone button, presses the keyboard shortcut, or explicitly enables Hands-Free / Wake-Word mode in `SettingsScreen`.

### 3.2 Ephemeral In-Memory Audio Ring Buffer
- When Wake-Word mode is engaged, audio is captured into an in-memory 1.5-second circular ring buffer (`Float32Array` / `Int16Array`).
- Audio samples are continuously evaluated for the wake-word probability threshold (e.g. `confidence > 0.5`).
- If no wake word is detected, older audio samples are discarded immediately in RAM.
- **Audio is never saved to the filesystem, database, or transmitted over any network socket.**

### 3.3 Explicit User Consent for Model Download
- In compliance with AURA's local-first rules, the runtime **never downloads models during normal startup**.
- Wake-word neural weights (`.onnx`) must be explicitly installed via developer CLI (`python -m aura_agent.scripts.setup_voice`) or through an explicit "Download & Verify Wake Word Model" button in `SettingsScreen` that displays the exact download size, source repository, and license before fetching.

### 3.4 Hardware Safety Gate
- A prominent live red recording indicator is permanently visible in both the TitleBar and the ChatInput bar whenever the microphone is receiving audio.
- A single master toggle (`settings.micEnabled: false`) immediately severs all microphone access and calls `MediaStreamTrack.stop()` across all active tracks.

---

## 4. Operational Modes Comparison

| Mode | Trigger | Continuous Mic | CPU Overhead | Use Case |
|---|---|---|---|---|
| **Push-to-Talk (PTT)** *(Default)* | Manual click or Space/Enter | **NO** | 0.0% when idle | Rock-solid reliability, 100% privacy assurance |
| **Conversational VAD** | Automatic End-of-Speech (EOS) | Only during active turn | ~0.1% Web Audio RMS | Hands-free continuous multi-turn dialogue |
| **Wake Word (`openWakeWord`)** | "Hey Jarvis" / "Hey AURA" | YES (Opt-in only) | ~1.5% CPU ONNX | Completely touch-free voice summoning |

---

## 5. Verification Protocol

1. **Speech Interruption (Barge-In)**: Starting voice input immediately terminates ongoing TTS playback and clears lip-sync visemes.
2. **Automatic Turn Detection**: Silence of > 1400 ms after speech automatically finalizes and sends the audio segment.
3. **Audio Cancellation**: Escape key or cancel button immediately releases hardware MediaStream and aborts pending transcription.
4. **Hardware Selection**: Correct routing of input streams from chosen microphone and audio output to chosen speaker.

