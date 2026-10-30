# AURA Character & VRM Model Integration Guide (Phase 4)

## 1. Overview

**AURA** (Autonomous Utility, Reasoning and Automation) incorporates a local, real-time 3D character display rendered directly inside the desktop interface. The character acts as the visual focus of the assistant, responding to assistant states, listening status, and voice synthesis without sacrificing workstation privacy or security.

---

## 2. Technical Architecture & Component Isolation

In accordance with AURA's local-first architecture:
- **Presentation Isolation**: The character rendering pipeline is strictly separated from AI decision-making, Ollama LLM execution, speech-to-text, and tool execution.
- **Three.js & @pixiv/three-vrm**: Rendered using standard hardware-accelerated WebGL through **Three.js** (`^0.186.x`) and **`@pixiv/three-vrm`** (`^3.5.x`).
- **Controlled Electron IPC**: Local `.vrm` files are loaded via isolated Electron IPC (`vrm:load-binary`), reading ArrayBuffers from local disk with strict validation.
- **Resource Management**:
  - The render loop automatically pauses when the application is minimized or hidden (`document.visibilityState === 'hidden'`).
  - Screen pixel ratio is capped at `2.0` to prevent excessive GPU overhead on high-DPI/4K displays.
  - Full disposal of Three.js geometries, materials, textures, and VRM spring bones on teardown.

```
┌────────────────────────────────────────────────────────┐
│                   AURA Desktop UI                      │
├──────────────────────────┬─────────────────────────────┤
│   AuraContext (State)    │   SettingsScreen & Dialog   │
│   - assistantState       │   - vrmModelPath            │
│   - isSpeaking (Audio)   │   - selectVrmFile (IPC)     │
└────────────┬─────────────┴──────────────┬──────────────┘
             │                            │
             ▼                            ▼
┌────────────────────────────────────────────────────────┐
│                   CharacterCanvas                      │
│             (React Lifecycle & ResizeObserver)         │
└────────────────────────────┬───────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│                 CharacterController                    │
│                 (Pure Three.js Engine)                 │
├────────────────────────────┬───────────────────────────┤
│   VRM 3D Character Mode    │   3D Holographic Fallback │
│   - @pixiv/three-vrm       │   - Geometric Core        │
│   - Humanoid Bone Retarget │   - Gimbal Orbital Rings  │
│   - Procedural Blinking    │   - Particle Constellation│
│   - Speech-Synced Mouth    │   - Audio Wave Reactive   │
│   - State Expressions      │   - Zero Remote Assets    │
└────────────────────────────┴───────────────────────────┘
```

---

## 3. Fallback Without External Assets

### Guarantee
AURA **never automatically downloads unknown character assets from the internet**.

When no custom VRM model is configured (or if a configured file is missing/unreadable), AURA automatically activates its **Procedural 3D Holographic Core**:
- **Central Core**: Faceted icosahedron with metallic-glass physical material and internal state-reactive glow.
- **Outer Shell**: High-frequency crystalline wireframe reacting to state changes.
- **Gimbal Orbital Rings**: 3 concentric rings rotating dynamically along different 3D axes. Rotation velocity scales dynamically:
  - `idle`: Gentle 0.45 rad/s orbital drift.
  - `listening`: Steady 1.6x pulse.
  - `thinking`: Rapid 3.2x rotation simulating high neural computation.
  - `speaking` / `responding`: Resonant expansion and audio wave pulsing.
  - `executing`: Structured clockwise orbital rotation.
  - `waiting_confirmation`: Inquisitive amber oscillations.
  - `error`: Subtle red pulse.
- **Particle Constellation**: 120 floating celestial particles drifting with gentle orbital motion.
- **Zero Disk Dependency**: The fallback requires zero disk assets or network requests.

---

## 4. Animation States & Behaviors

The character automatically reflects the assistant's workflow states:

| State | Color Code | Lighting | Character Posture & Expression | Fallback Ring Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Idle** | `#00f2fe` (Cyan) | Soft ambient, cyan rim glow | Natural breathing, subtle head sway, neutral/happy expression | Relaxed orbital drift |
| **Listening** | `#2cb67d` (Emerald) | Focused green rim accent | Head tilted slightly, alert eye posture, relaxed smile | Medium rotation, audio-ready |
| **Thinking** | `#7f5af0` (Violet) | Violet key light | Head tilted thoughtfully, focused gaze | Rapid orbital spin (3.2x) |
| **Speaking / Responding** | `#4facfe` (Sky Blue) | Dynamic blue rim light | Speech-synced mouth animation (`aa`, `oh`), rhythmic head emphasis | Harmonic wave expansion |
| **Executing** | `#ff8906` (Amber Orange) | Warm directional light | Focused posture, upright pose | Energetic clockwise spin |
| **Waiting Confirmation** | `#ffd166` (Gold) | Amber review glow | Inquisitive head tilt, attentive eyes | Gentle oscillating wave |
| **Error** | `#e53170` (Crimson) | Red anomaly light | Head tilted down, concerned expression | Jittery slow pulse |

### Blinking & Facial Expressions
- **Procedural Blinking**: Blinks naturally every 3.0 to 6.0 seconds using a smoothed sine curve (`VRMExpressionPresetName.Blink`).
- **Speaking Mouth Movement**: During speech playback (`isSpeaking` / Piper TTS audio playback), mouth opening is dynamically modulated using smoothed sine wave frequencies blending vowel visemes (`VRMExpressionPresetName.Aa` and `VRMExpressionPresetName.Oh`). Mouth closes smoothly upon audio completion.
- *Notice*: AURA implements time-smoothed viseme modulation synchronized with audio playback. It does not claim phonetic accuracy derived from acoustic phoneme alignment unless a dedicated acoustic alignment model is active.

---

## 5. Adding a User-Supplied VRM Model

Users can personalize AURA with any custom humanoid VRM model.

### Supported Specifications
- **VRM 0.0**: Standard format exported by earlier VRoid Studio and Blender tools (automatically rotated 180° by `VRMUtils.rotateVRM0` for proper frontal orientation).
- **VRM 1.0**: Modern official standard specification from the VRM Consortium.

### Step-by-Step Instructions

#### Method 1: Using the Desktop Interface (Recommended)
1. Open the **AURA Desktop Application**.
2. Navigate to the **Stage** tab from the left sidebar.
3. Click the **Load VRM** button in the top-right telemetry bar (or open **Settings** > **Animated Character & VRM Model**).
4. Select any local `.vrm` file from your workstation (e.g. `C:\Users\<YourUser>\Documents\Avatars\my_character.vrm`).
5. AURA immediately loads the avatar into the hardware WebGL canvas.

#### Method 2: Manual Path in Configuration
1. Place your model in a local directory, for example:
   ```
   C:\Projects\AURA\models\vrm\assistant.vrm
   ```
2. In **Settings** > **Configurable Local VRM Model File Path**, enter:
   ```
   C:\Projects\AURA\models\vrm\assistant.vrm
   ```
3. To revert back to the 3D procedural holographic core at any time, click **Use Fallback** or clear the file path.

---

## 6. Asset Licensing & Attribution Guidelines

When selecting or distributing VRM models, adhere to the model creator's licensing:

### 1. Where to Acquire Free and Open VRM Models
- **VRoid Studio (Self-Created)**: Avatars created by you in [VRoid Studio](https://vroid.com/en/studio) belong to you and can be exported as `.vrm` files with complete freedom for local personal use.
- **VRoid Hub**: Check each model's license conditions prior to downloading:
  - *Commercial Use*: Allowed / Disallowed.
  - *Modification*: Allowed / Disallowed.
  - *Attribution*: Whether the original creator must be credited.
  - *Avatar Personality / Persona Restrictions*: Some models forbid political, violent, or commercial representation.
- **Open-Source & Public Domain (CC0)**: Models released under **Creative Commons Zero (CC0)** or **CC-BY 4.0** (e.g., standard tutorial models, Seed-san, Alicia Solid).

### 2. Attribution Template
If bundling or documenting a custom VRM avatar in a shared deployment, include attribution in your project's `CREDITS.md`:

```markdown
### 3D Character Model Attribution
- **Model Name**: [Model Name]
- **Creator**: [Artist / Studio Name]
- **Source**: [URL / Repository]
- **License**: [e.g., CC-BY 4.0 / VRoid Hub Personal License]
- **Usage Restrictions**: [e.g., Non-commercial personal assistant]
```

### 3. Compliance Verification
- Never upload confidential enterprise data to online avatar conversion tools.
- Keep avatar files local on disk; AURA enforces this by rejecting remote asset URLs.
