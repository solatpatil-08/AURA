# AURA Hardware & WebGL Investigation Report

**Hardware Profile**:
- **GPU0**: Intel UHD Graphics (Active integrated)
- **GPU1**: NVIDIA GeForce RTX 3050 Laptop GPU (6GB Dedicated VRAM, Discrete)
- **Host OS**: Windows 11 64-bit
- **Graphics API**: Direct3D 11 via ANGLE / WebGL 2.0
- **3D Runtime**: Three.js v0.186.1, @pixiv/three-vrm v3.5.5, Electron v34.2.0

---

## 1. Executive Summary & Root Cause Analysis

### A. The Immediate Errors
The AURA desktop application previously encountered two sequential WebGL initialization exceptions:
1. `WebGL initialization failed: Cannot read properties of null (reading 'indexOf')`
2. `WebGL initialization failed: Cannot read properties of null (reading 'precision')`

### B. Root Cause 1: Driver-Level EGL / ANGLE Version Mismatch on Dual-GPU Laptops
On laptops with dual GPUs (Intel UHD + NVIDIA RTX 3050), Chromium defaults to the integrated Intel GPU. Chromium's internal workarounds list for this Intel GPU explicitly includes:
- `msaa_is_slow`
- `max_msaa_sample_count_4`
- `exit_on_context_lost`

When Three.js requested `antialias: true` (Multi-Sample Anti-Aliasing / MSAA) on the default GPU without explicit flags:
- ANGLE attempted to allocate an EGL context with unsupported MSAA sample buffers.
- Chromium logged: `eglCreateContext: Requested version is not supported`.
- As a result, critical context queries returned `null` instead of standard specification values:
  - `gl.getParameter(gl.VERSION)` returned `null` -> Three.js `WebGLState.js` line 389 evaluated `glVersion.indexOf('WebGL')` on `null` -> `Cannot read properties of null (reading 'indexOf')`.
  - `gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT)` returned `null` -> Three.js `WebGLCapabilities.js` line 59 evaluated `gl.getShaderPrecisionFormat(...).precision` on `null` -> `Cannot read properties of null (reading 'precision')`.

### C. Root Cause 2: Non-Writable WebIDL Prototype Operations in Chromium
In Chromium/Blink, WebGL interface methods (`getShaderPrecisionFormat`, `getParameter`) are defined on `WebGLRenderingContextBase.prototype` with `{ writable: false, configurable: true }`.
When JavaScript strict mode modules (used in modern Vite / ES builds) attempted to reassign prototype methods via normal assignment:
```javascript
WebGL2RenderingContext.prototype.getShaderPrecisionFormat = function(...) { ... }
```
The assignment was either silently ignored or failed, leaving `getShaderPrecisionFormat` unpatched on context instances.

### D. Root Cause 3: Self-Inflicted Context Loss on Component Cleanup
In `CharacterController.dispose()`, `this.renderer.forceContextLoss()` was being called on normal unmount. Under React 18 strict mode and re-renders, the canvas was permanently destroyed before rendering could resume.

---

## 2. Technical Solution Architecture

### 1. Forcing Discrete NVIDIA RTX 3050 via Electron Command Line Switches
To bypass the unstable Intel EGL driver path entirely, Electron main process (`apps/desktop/src/main/index.ts`) was configured with explicit GPU targeting switches:
```typescript
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('use-angle', 'd3d11')
```
- `--force_high_performance_gpu`: Directs Windows DXGI / display driver to bind the application to GPU1 (NVIDIA RTX 3050).
- `--use-angle=d3d11`: Employs Microsoft Direct3D 11 as the ANGLE backend instead of experimental OpenGL ES / EGL translators.

### 2. Triple-Layered WebGL Context Wrapping (`wrapWebGLContextInstance`)
Rather than relying solely on prototype mutation, AURA implements direct context wrapping:
1. **Direct Instance Definition**: When `this.canvas.getContext('webgl2')` creates a context, `wrapWebGLContextInstance(gl)` applies `Object.defineProperty` directly to `gl.getShaderPrecisionFormat` and `gl.getParameter`.
2. **Context Passing to Three.js**: Three.js `WebGLRenderer` accepts `context: gl`. By passing the pre-acquired, pre-secured context directly, Three.js is guaranteed to use the protected context.
3. **Full Prototype Chain Walk**: `patchWebGLPrototypesSafely` traverses from `WebGL2RenderingContext.prototype` up to `Object.prototype`, patching every prototype layer with `Object.defineProperty(..., { writable: true, configurable: true })`.
4. **Canvas `getContext` Hooking**: `HTMLCanvasElement.prototype.getContext` wraps any context instantiated downstream.

### 3. Conservative Context Attributes
Eliminates MSAA failure vectors while maximizing hardware performance:
```typescript
const contextAttributes: WebGLContextAttributes = {
  alpha: true,
  antialias: false,                  // Eliminates msaa_is_slow & EGL version mismatch
  depth: true,
  stencil: false,                    // Avoids unnecessary stencil allocation
  powerPreference: 'high-performance',// Signals discrete NVIDIA GPU
  preserveDrawingBuffer: false        // Fast compositing
}
```

### 4. Removal of Destructive `forceContextLoss`
`CharacterController.dispose()` now cleanly disposes Three.js geometries, materials, textures, and animation frames without invoking `forceContextLoss()`.

### 5. Pure CSS/SVG Standby Avatar Fallback
Implemented `CssAvatarFallback.tsx` — a 100% SVG/CSS holographic cybernetic core requiring zero WebGL or Three.js dependencies, providing visual parity and interactive state response if GPU hardware acceleration is ever disabled by host policy.

---

## 3. Source Files Modified

| File | Changes Made |
| :--- | :--- |
| `apps/desktop/src/main/index.ts` | Added `--force_high_performance_gpu`, `--use-angle=d3d11`, and `gpu-info-update` diagnostics listener. |
| `apps/desktop/src/main/ipc.ts` | Implemented `system:get-gpu-diagnostics` IPC handler querying Chromium's complete GPU profile. |
| `apps/desktop/src/renderer/src/components/avatar/CharacterController.ts` | Added `wrapWebGLContextInstance`, deep prototype chain patching via `Object.defineProperty`, pre-acquired context injection into Three.js, removed `forceContextLoss()` from `dispose()`, and implemented context lost retry capping. |
| `apps/desktop/src/renderer/src/components/avatar/WebGLDiagnostic.ts` | Created independent 7-stage isolated pipeline (Stages A to G) and WebGL2 diagnostic reporter. |
| `apps/desktop/src/renderer/src/components/avatar/CssAvatarFallback.tsx` | Created zero-WebGL CSS/SVG fallback avatar with waveform animations and retry trigger. |
| `apps/desktop/src/renderer/src/components/avatar/CharacterCanvas.tsx` | Integrated `CssAvatarFallback` on WebGL failure, wired retry handlers, prevented duplicate error messages. |
| `apps/desktop/src/renderer/src/components/avatar/AvatarStage.tsx` | Added real GPU badge (`NVIDIA RTX` / `Active GPU`), actual FPS readout (0 when stopped), and reset counter. |
| `apps/desktop/test/setup.ts` | Added mock WebGL constants and context provider for headless JSDOM testing. |
| `apps/desktop/test/AvatarEngine.test.tsx` | Verified 7-stage isolated pipeline, context lost handling, and zero-FPS reporting. |

---

## 4. Verification & Test Results

### Automated Unit Test Suite
- **Test Command**: `npm --prefix apps/desktop test`
- **Result**: `7 passed (7 test files), 53 passed (53 tests)`
- **Isolated Pipeline**: Stages A, B, C, D, E, F, and G executed in exact order with 100% success.
- **Model Validation**: `aura.vrm` (18.3 MB) loaded, verified with humanoid bones, expressions, and visemes.

### TypeScript Typecheck & Production Build
- **Typecheck**: `npm --prefix apps/desktop run typecheck` -> Exited with code 0 (clean).
- **Production Build**: `npm --prefix apps/desktop run build` -> Exited with code 0.
  - `out/main/index.js`: 12.28 kB
  - `out/preload/index.js`: 1.20 kB
  - `out/renderer/index.html` & assets: 2,198 kB bundle built in 7.33s.
