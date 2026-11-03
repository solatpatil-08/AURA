import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  VRM,
  VRMLoaderPlugin,
  VRMUtils,
  VRMExpressionPresetName,
  VRMHumanBoneName
} from '@pixiv/three-vrm'
import { AssistantState, CharacterRenderMode, CharacterTelemetry } from '../../types'

export type GraphicsErrorCategory =
  | 'gpu_unavailable'
  | 'webgl2_unsupported'
  | 'renderer_init_failed'
  | 'vrm_load_failed'
  | 'shader_material_failed'
  | 'context_lost'
  | 'unknown_exception'

export interface CharacterControllerOptions {
  onTelemetry?: (telemetry: Partial<CharacterTelemetry>) => void
  onError?: (error: string, category?: GraphicsErrorCategory) => void
  autoAnimate?: boolean
}

const STATE_PALETTES: Record<AssistantState, { primary: number; glow: number; ambientIntensity: number }> = {
  idle: { primary: 0x00f2fe, glow: 0x00c4cc, ambientIntensity: 0.9 },
  listening: { primary: 0x2cb67d, glow: 0x1f9463, ambientIntensity: 1.0 },
  transcribing: { primary: 0xf5a623, glow: 0xd98218, ambientIntensity: 1.1 },
  thinking: { primary: 0x7f5af0, glow: 0x643fe3, ambientIntensity: 1.1 },
  responding: { primary: 0x4facfe, glow: 0x00f2fe, ambientIntensity: 1.1 },
  speaking: { primary: 0x4facfe, glow: 0x00f2fe, ambientIntensity: 1.1 },
  executing: { primary: 0xff8906, glow: 0xe57800, ambientIntensity: 1.0 },
  waiting_confirmation: { primary: 0xffd166, glow: 0xf4b942, ambientIntensity: 1.0 },
  cancelled: { primary: 0xa0aec0, glow: 0x718096, ambientIntensity: 0.8 },
  error: { primary: 0xe53170, glow: 0xc42058, ambientIntensity: 1.2 }
}

/**
 * Pre-flight WebGL2 capability check.
 * Strictly verifies whether WebGL2 context can be obtained and is not lost.
 */
export interface WebGL2VerificationResult {
  isSupported: boolean
  category?: GraphicsErrorCategory
  errorMessage?: string
  glVersion?: string
  renderer?: string
  vendor?: string
}

export function verifyWebGL2Support(canvas: HTMLCanvasElement): WebGL2VerificationResult {
  if (typeof window === 'undefined' || !window.WebGL2RenderingContext) {
    return {
      isSupported: false,
      category: 'webgl2_unsupported',
      errorMessage: 'WebGL2 is not supported in this runtime environment. A modern Chromium/Electron build is required.'
    }
  }

  try {
    // Conservative WebGL2 settings: no MSAA (avoids msaa_is_slow & EGL version mismatch),
    // high-performance power preference (requests discrete NVIDIA RTX 3050 GPU)
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    })

    if (!gl) {
      return {
        isSupported: false,
        category: 'gpu_unavailable',
        errorMessage: 'Unable to acquire a WebGL2 rendering context. Hardware acceleration may be disabled or blocked.'
      }
    }

    if (gl.isContextLost()) {
      return {
        isSupported: false,
        category: 'context_lost',
        errorMessage: 'The WebGL2 context was lost immediately upon creation.'
      }
    }

    const version = gl.getParameter(gl.VERSION)
    let renderer = gl.getParameter(gl.RENDERER)
    let vendor = gl.getParameter(gl.VENDOR)

    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    if (dbg) {
      const uRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      if (typeof uRenderer === 'string') renderer = uRenderer
      const uVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
      if (typeof uVendor === 'string') vendor = uVendor
    }

    return {
      isSupported: true,
      glVersion: typeof version === 'string' ? version : 'WebGL 2.0',
      renderer: typeof renderer === 'string' ? renderer : 'WebKit WebGL',
      vendor: typeof vendor === 'string' ? vendor : 'WebKit'
    }
  } catch (err) {
    return {
      isSupported: false,
      category: 'renderer_init_failed',
      errorMessage: `WebGL2 pre-flight verification error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

/**
 * Defensive fallback format for getShaderPrecisionFormat
 */
const DEFAULT_SHADER_PRECISION = {
  precision: 23,
  rangeMin: 127,
  rangeMax: 127
}

/**
 * Defensive parameter map for gl.getParameter
 */
function getSafeParameterFallback(pname: number): unknown {
  switch (pname) {
    case 0x1F02: // gl.VERSION
      return 'WebGL 2.0 (OpenGL ES 3.0 Chromium)'
    case 0x8B8C: // gl.SHADING_LANGUAGE_VERSION
      return 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)'
    case 0x1F00: // gl.VENDOR
      return 'WebKit'
    case 0x1F01: // gl.RENDERER
      return 'WebKit WebGL'
    case 0x8872: // gl.MAX_TEXTURE_IMAGE_UNITS
      return 16
    case 0x8B4D: // gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS
      return 32
    case 0x8869: // gl.MAX_VERTEX_ATTRIBS
      return 16
    case 0x0D33: // gl.MAX_TEXTURE_SIZE
      return 4096
    case 0x8515: // gl.MAX_CUBE_MAP_TEXTURE_SIZE
      return 4096
    case 0x8DF8: // gl.MAX_VERTEX_UNIFORM_VECTORS
      return 256
    case 0x8DF9: // gl.MAX_VARYING_VECTORS
      return 15
    case 0x8DFA: // gl.MAX_FRAGMENT_UNIFORM_VECTORS
      return 256
    case 0x8A2B: // gl.MAX_UNIFORM_BUFFER_BINDINGS
      return 24
    case 0x8CE0: // gl.MAX_COLOR_ATTACHMENTS
      return 8
    case 0x8D57: // gl.MAX_DRAW_BUFFERS
      return 8
    case 0x8824: // gl.MAX_RENDERBUFFER_SIZE
      return 4096
    case 0x8D56: // gl.MAX_SAMPLES
      return 4
    case 0x8DF0: // gl.SAMPLES
      return 0
    case 0x0C10: // gl.SCISSOR_BOX
      return new Int32Array([0, 0, 1920, 1080])
    case 0x0BA2: // gl.VIEWPORT
      return new Int32Array([0, 0, 1920, 1080])
    default:
      return null
  }
}

/**
 * Directly wraps a WebGL context instance so that calls to getShaderPrecisionFormat
 * or getParameter NEVER return null or invalid values that would crash Three.js WebGLCapabilities / WebGLState.
 */
export function wrapWebGLContextInstance(gl: any): void {
  if (!gl || gl.__auraWrapped) return

  // 1. Wrap getShaderPrecisionFormat
  const origPrecision = gl.getShaderPrecisionFormat ? gl.getShaderPrecisionFormat.bind(gl) : null
  try {
    Object.defineProperty(gl, 'getShaderPrecisionFormat', {
      value: function (shaderType: number, precisionType: number) {
        try {
          if (origPrecision) {
            const res = origPrecision(shaderType, precisionType)
            if (res && typeof res.precision === 'number' && res.precision > 0) {
              return res
            }
          }
        } catch {
          // Fallback
        }
        return DEFAULT_SHADER_PRECISION
      },
      writable: true,
      configurable: true
    })
  } catch {
    // If defineProperty is blocked, fallback to direct assignment
    try {
      gl.getShaderPrecisionFormat = function () {
        return DEFAULT_SHADER_PRECISION
      }
    } catch {
      // Ignore
    }
  }

  // 2. Wrap getParameter
  const origGetParameter = gl.getParameter ? gl.getParameter.bind(gl) : null
  try {
    Object.defineProperty(gl, 'getParameter', {
      value: function (pname: number) {
        try {
          if (origGetParameter) {
            const res = origGetParameter(pname)
            if (res !== null && res !== undefined) {
              if (
                pname === 0x1F02 /* VERSION */ ||
                pname === 0x8B8C /* SHADING_LANGUAGE_VERSION */ ||
                pname === 0x1F00 /* VENDOR */ ||
                pname === 0x1F01 /* RENDERER */
              ) {
                if (typeof res === 'string' && res.length > 0) return res
              } else {
                return res
              }
            }
          }
        } catch {
          // Fallback
        }
        return getSafeParameterFallback(pname)
      },
      writable: true,
      configurable: true
    })
  } catch {
    // Ignore
  }

  gl.__auraWrapped = true
}

/**
 * Defensive patch for Chromium / ANGLE / Windows graphics drivers where WebGL queries
 * may return null or unexpected non-spec values under certain hardware/policy conditions.
 *
 * Specifically addresses:
 * 1. gl.getParameter(gl.VERSION) returning null -> crashes Three.js WebGLState (.indexOf('WebGL'))
 * 2. gl.getShaderPrecisionFormat returning null -> crashes Three.js WebGLCapabilities (.precision)
 * 3. gl.getParameter for limits (MAX_TEXTURE_SIZE, MAX_VERTEX_ATTRIBS, etc.) returning null
 */
export function patchWebGLPrototypesSafely(): void {
  if (typeof window === 'undefined') return

  // 1. Hook HTMLCanvasElement.prototype.getContext to automatically wrap any created context
  if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) {
    const canvasProto = HTMLCanvasElement.prototype as any
    if (!canvasProto.__auraGetContextPatched) {
      const origGetContext = canvasProto.getContext
      canvasProto.getContext = function (contextId: string, ...args: any[]) {
        let ctx: any = null
        try {
          ctx = origGetContext.apply(this, [contextId, ...args])
        } catch {
          // In test environments or headless, getContext may throw
        }
        if (ctx && (contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl')) {
          wrapWebGLContextInstance(ctx)
        }
        return ctx
      }
      canvasProto.__auraGetContextPatched = true
    }
  }

  // 2. Patch prototypes on the prototype chain using Object.defineProperty
  const patchPrototypeObject = (protoObj: any) => {
    if (!protoObj || protoObj.__auraWebGLPatched) return

    try {
      const origPrecision = protoObj.getShaderPrecisionFormat
      Object.defineProperty(protoObj, 'getShaderPrecisionFormat', {
        value: function (shaderType: number, precisionType: number) {
          try {
            if (origPrecision) {
              const res = origPrecision.call(this, shaderType, precisionType)
              if (res && typeof res.precision === 'number' && res.precision > 0) return res
            }
          } catch {}
          return DEFAULT_SHADER_PRECISION
        },
        writable: true,
        configurable: true
      })
    } catch {}

    try {
      const origGetParameter = protoObj.getParameter
      Object.defineProperty(protoObj, 'getParameter', {
        value: function (pname: number) {
          try {
            if (origGetParameter) {
              const res = origGetParameter.call(this, pname)
              if (res !== null && res !== undefined) {
                if (
                  pname === 0x1F02 ||
                  pname === 0x8B8C ||
                  pname === 0x1F00 ||
                  pname === 0x1F01
                ) {
                  if (typeof res === 'string' && res.length > 0) return res
                } else {
                  return res
                }
              }
            }
          } catch {}
          return getSafeParameterFallback(pname)
        },
        writable: true,
        configurable: true
      })
    } catch {}

    protoObj.__auraWebGLPatched = true
  }

  const patchChain = (startObj: any) => {
    let curr = startObj
    while (curr && curr !== Object.prototype) {
      patchPrototypeObject(curr)
      curr = Object.getPrototypeOf(curr)
    }
  }

  if (window.WebGLRenderingContext) patchChain(window.WebGLRenderingContext.prototype)
  if (window.WebGL2RenderingContext) patchChain(window.WebGL2RenderingContext.prototype)
}

/**
 * Isolated CharacterController managing Three.js canvas rendering,
 * procedural holographic fallback graphics, and @pixiv/three-vrm character animation.
 *
 * Implements:
 * - Natural breathing, blinking, and multi-frequency head motions.
 * - Explicit visual states (idle, listening, thinking, speaking, executing, error).
 * - Safe VRM expression weight mutations with expression presence checks.
 * - Real-time audio amplitude analysis with AnalyserNode for lip-sync visemes.
 * - Accessible animation scaling for reduced-motion preferences.
 * - Robust GLTF/VRM header and humanoid bone validation.
 */
export class CharacterController {
  private canvas: HTMLCanvasElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer | null = null
  private timer: THREE.Timer

  // Lights
  private ambientLight: THREE.AmbientLight
  private directionalLight: THREE.DirectionalLight
  private rimLight: THREE.PointLight
  private frontLight: THREE.PointLight

  // Model & Fallback states
  private mode: CharacterRenderMode = 'procedural'
  private currentVrm: VRM | null = null
  private proceduralGroup: THREE.Group
  private coreMesh: THREE.Mesh
  private wireframeMesh: THREE.Mesh
  private ring1: THREE.Mesh
  private ring2: THREE.Mesh
  private ring3: THREE.Mesh
  private particles: THREE.Points

  // Animation states
  private currentState: AssistantState = 'idle'
  private isSpeaking: boolean = false
  private animFrameId: number | null = null
  private isPaused: boolean = false

  // Blinking procedural loop
  private blinkTimer: number = 0
  private nextBlinkInterval: number = 3.5
  private blinkProgress: number = 0
  private isBlinking: boolean = false

  // Audio Amplitude Analysis & Lip-Sync
  private audioAnalyser: AnalyserNode | null = null
  private audioFreqData: Uint8Array<ArrayBuffer> | null = null
  private currentAudioAmplitude: number = 0
  private currentVisemeAa: number = 0
  private currentVisemeOh: number = 0
  private currentVisemeIh: number = 0
  private targetVisemeAa: number = 0
  private targetVisemeOh: number = 0
  private targetVisemeIh: number = 0

  // Expression registry & metadata
  private availableExpressions: Set<string> = new Set()
  private vrmMetaInfo: CharacterTelemetry['vrmMeta'] = undefined

  // Accessibility & reduced motion
  private reducedMotion: boolean = false
  private mediaQueryList: MediaQueryList | null = null
  private mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null

  // Telemetry & metrics
  private onTelemetry?: (telemetry: Partial<CharacterTelemetry>) => void
  private onError?: (error: string, category?: GraphicsErrorCategory) => void
  private frameCount: number = 0
  private lastFpsCheck: number = 0
  private currentFps: number = 60

  // Hardware & Health Tracking (Phase 8)
  private activeGpuRenderer: string = 'Detecting...'
  private activeGpuVendor: string = 'Detecting...'
  private contextLostCount: number = 0
  private recoveryAttempts: number = 0
  private readonly MAX_RECOVERY_ATTEMPTS: number = 3
  private stableRenderTimer: number = 0
  private avatarVisible: boolean = false

  // Lifecycle & Context Loss guards
  private isDisposed: boolean = false
  private isContextLost: boolean = false
  private lastLoadedBuffer: ArrayBuffer | null = null

  constructor(canvas: HTMLCanvasElement, options: CharacterControllerOptions = {}) {
    this.canvas = canvas
    this.onTelemetry = options.onTelemetry
    this.onError = options.onError
    this.timer = new THREE.Timer()

    // Context loss event handling
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false)
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false)

    // 1. Accessibility: Detect prefers-reduced-motion preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      try {
        this.mediaQueryList = window.matchMedia('(prefers-reduced-motion: reduce)')
        this.reducedMotion = this.mediaQueryList.matches
        this.mediaQueryListener = (e: MediaQueryListEvent) => {
          this.reducedMotion = e.matches
        }
        this.mediaQueryList.addEventListener('change', this.mediaQueryListener)
      } catch {
        // Fallback for test runners lacking full matchMedia implementation
      }
    }

    // 2. Initialize Three.js Scene
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 25)
    this.camera.position.set(0, 0, 3.8)

    // 3. Initialize WebGLRenderer with defensive multi-tier fallback
    this.renderer = this.createRenderer()

    // 4. Initialize Lighting
    const initialPalette = STATE_PALETTES.idle
    this.ambientLight = new THREE.AmbientLight(0xffffff, initialPalette.ambientIntensity)
    this.scene.add(this.ambientLight)

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.3)
    this.directionalLight.position.set(1.5, 2.5, 2.0)
    this.scene.add(this.directionalLight)

    this.rimLight = new THREE.PointLight(initialPalette.primary, 2.2, 8)
    this.rimLight.position.set(-1.2, 1.4, -1.0)
    this.scene.add(this.rimLight)

    this.frontLight = new THREE.PointLight(initialPalette.glow, 1.0, 6)
    this.frontLight.position.set(0, 0.5, 1.8)
    this.scene.add(this.frontLight)

    // 5. Construct Visually Striking Procedural Fallback 3D Character
    this.proceduralGroup = new THREE.Group()
    this.scene.add(this.proceduralGroup)

    // Central geometric core
    const coreGeo = new THREE.IcosahedronGeometry(0.8, 1)
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x111625,
      emissive: initialPalette.primary,
      emissiveIntensity: 0.45,
      metalness: 0.85,
      roughness: 0.18,
      transparent: true,
      opacity: 0.88
    })
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat)
    this.proceduralGroup.add(this.coreMesh)

    // Outer crystalline wireframe shell
    const wireGeo = new THREE.IcosahedronGeometry(0.9, 1)
    const wireMat = new THREE.MeshBasicMaterial({
      color: initialPalette.primary,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    })
    this.wireframeMesh = new THREE.Mesh(wireGeo, wireMat)
    this.proceduralGroup.add(this.wireframeMesh)

    // Gimbal Ring 1 (Inner)
    const ringGeo1 = new THREE.TorusGeometry(1.25, 0.016, 16, 80)
    const ringMat1 = new THREE.MeshStandardMaterial({
      color: initialPalette.primary,
      emissive: initialPalette.primary,
      emissiveIntensity: 0.6,
      roughness: 0.3
    })
    this.ring1 = new THREE.Mesh(ringGeo1, ringMat1)
    this.proceduralGroup.add(this.ring1)

    // Gimbal Ring 2 (Middle)
    const ringGeo2 = new THREE.TorusGeometry(1.5, 0.014, 16, 80)
    const ringMat2 = new THREE.MeshStandardMaterial({
      color: initialPalette.glow,
      emissive: initialPalette.glow,
      emissiveIntensity: 0.5,
      roughness: 0.3
    })
    this.ring2 = new THREE.Mesh(ringGeo2, ringMat2)
    this.ring2.rotation.x = Math.PI / 3
    this.proceduralGroup.add(this.ring2)

    // Gimbal Ring 3 (Outer)
    const ringGeo3 = new THREE.TorusGeometry(1.75, 0.012, 16, 80)
    const ringMat3 = new THREE.MeshStandardMaterial({
      color: initialPalette.primary,
      emissive: initialPalette.primary,
      emissiveIntensity: 0.4,
      roughness: 0.3
    })
    this.ring3 = new THREE.Mesh(ringGeo3, ringMat3)
    this.ring3.rotation.y = Math.PI / 4
    this.proceduralGroup.add(this.ring3)

    // Surrounding ambient floating particles
    const particleCount = 120
    const particleGeo = new THREE.BufferGeometry()
    const particlePositions = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount; i++) {
      const radius = 1.2 + Math.random() * 1.5
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(Math.random() * 2 - 1)
      particlePositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      particlePositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      particlePositions[i * 3 + 2] = radius * Math.cos(phi)
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
    const particleMat = new THREE.PointsMaterial({
      color: initialPalette.primary,
      size: 0.04,
      transparent: true,
      opacity: 0.65
    })
    this.particles = new THREE.Points(particleGeo, particleMat)
    this.proceduralGroup.add(this.particles)

    // 6. Setup visibility change listener to avoid background CPU/GPU usage
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
    const shouldAnimate = options.autoAnimate ?? !isTestEnv

    // 7. Start Render Loop
    if (this.renderer && shouldAnimate) {
      this.lastFpsCheck = performance.now()
      this.animate()
    }

    this.notifyTelemetry()
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.pause()
    } else {
      this.resume()
    }
  }

  public pause(): void {
    this.isPaused = true
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    this.currentFps = 0
    this.notifyTelemetry({ fps: 0 })
  }

  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false
      this.timer.update()
      if (this.animFrameId === null && this.renderer) {
        this.animate()
      }
    }
  }

  private createRenderer(): THREE.WebGLRenderer | null {
    patchWebGLPrototypesSafely()

    try {
      // Phase 3 Conservative WebGL Attributes:
      // - antialias: false (disables MSAA to avoid ANGLE msaa_is_slow & EGL version mismatch)
      // - powerPreference: 'high-performance' (signals GPU driver to switch to NVIDIA RTX 3050)
      // - depth: true, stencil: false (avoids unnecessary stencil allocations)
      // - preserveDrawingBuffer: false (enables zero-copy compositing)
      const contextAttributes: WebGLContextAttributes = {
        alpha: true,
        antialias: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
      }

      // Explicitly acquire and defensively wrap context instance
      let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null
      try {
        gl = this.canvas.getContext('webgl2', contextAttributes)
        if (!gl) {
          gl = this.canvas.getContext('webgl', contextAttributes)
        }
      } catch (e) {
        console.warn('[CharacterController] Direct context acquisition error:', e)
      }

      if (gl) {
        wrapWebGLContextInstance(gl)
      }

      const r = new THREE.WebGLRenderer({
        canvas: this.canvas,
        context: gl || undefined,
        alpha: true,
        antialias: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        precision: 'highp'
      })
      r.outputColorSpace = THREE.SRGBColorSpace
      r.setPixelRatio(1.0) // 1:1 hardware pixel ratio without unnecessary 2x retina oversampling

      // Query active GPU renderer and vendor
      const activeGl = gl || (typeof (r as any).getContext === 'function' ? (r as any).getContext() : null)
      if (activeGl) {
        const dbg = activeGl.getExtension('WEBGL_debug_renderer_info')
        if (dbg) {
          const uRenderer = activeGl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
          if (typeof uRenderer === 'string') this.activeGpuRenderer = uRenderer
          const uVendor = activeGl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
          if (typeof uVendor === 'string') this.activeGpuVendor = uVendor
        }
        if (this.activeGpuRenderer === 'Detecting...') {
          const stdRenderer = activeGl.getParameter(activeGl.RENDERER)
          if (typeof stdRenderer === 'string') this.activeGpuRenderer = stdRenderer
        }
      }

      return r
    } catch (err) {
      const originalMsg = err instanceof Error ? err.message : String(err)
      let category: GraphicsErrorCategory = 'renderer_init_failed'
      const lower = originalMsg.toLowerCase()
      if (lower.includes('hardware acceleration') || lower.includes('policy')) {
        category = 'gpu_unavailable'
      } else if (lower.includes('webgl 2 is not supported') || lower.includes('not supported')) {
        category = 'webgl2_unsupported'
      }
      const fatalMsg = `WebGL initialization failed: ${originalMsg}`
      console.error('[CharacterController]', fatalMsg)
      if (this.onError) this.onError(fatalMsg, category)
      return null
    }
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault()
    this.isContextLost = true
    this.contextLostCount++
    this.avatarVisible = false
    this.currentFps = 0
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    const errMsg = `WebGL graphics context was lost (event #${this.contextLostCount}). Waiting for restoration...`
    console.warn('[CharacterController]', errMsg)
    if (this.onError) this.onError(errMsg, 'context_lost')
    this.notifyTelemetry({
      contextLostCount: this.contextLostCount,
      avatarVisible: false,
      fps: 0,
      rendererReady: false
    })
  }

  private handleContextRestored = (): void => {
    console.info('[CharacterController] WebGL context restored. Rebuilding scene...')
    this.isContextLost = false
    this.recoveryAttempts++

    if (this.recoveryAttempts > this.MAX_RECOVERY_ATTEMPTS) {
      const limitMsg = 'WebGL context recovery limit exceeded (3 attempts). Switching to CSS/SVG fallback.'
      console.error('[CharacterController]', limitMsg)
      if (this.onError) this.onError(limitMsg, 'context_lost')
      return
    }

    this.renderer = this.createRenderer()
    if (this.renderer) {
      if (this.mode === 'vrm' && this.lastLoadedBuffer) {
        this.loadModelFromBuffer(this.lastLoadedBuffer, this.vrmMetaInfo?.title || 'Custom VRM').catch(() => {
          this.resetToProceduralFallback()
        })
      } else {
        this.resetToProceduralFallback()
      }
      if (!this.isPaused && !this.isDisposed) {
        this.animate()
      }
    }
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0 || !this.renderer) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  public setState(state: AssistantState): void {
    this.currentState = state
    this.applyStateVisuals(state)
    this.notifyTelemetry()
  }

  public setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking
    this.notifyTelemetry()
  }

  /**
   * Connect an active Web Audio AnalyserNode to drive real-time mouth viseme animation.
   * Uses audio amplitude and frequency distribution analysis.
   */
  public setAudioAnalyser(analyser: AnalyserNode | null): void {
    this.audioAnalyser = analyser
    if (analyser) {
      this.audioFreqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    } else {
      this.audioFreqData = null
      this.currentAudioAmplitude = 0
      this.targetVisemeAa = 0
      this.targetVisemeOh = 0
      this.targetVisemeIh = 0
    }
  }

  /**
   * Defensive expression weight setter.
   * Only mutates expression weights if the expression is supported by the loaded VRM character.
   */
  private safeSetExpression(name: string, value: number): void {
    if (!this.currentVrm?.expressionManager) return
    const targetName = this.resolveExpressionName(name)
    if (targetName) {
      try {
        this.currentVrm.expressionManager.setValue(targetName, Math.max(0, Math.min(1, value)))
      } catch {
        // Silently catch unsupported expression application
      }
    }
  }

  private resolveExpressionName(name: string): string | null {
    if (!this.currentVrm?.expressionManager) return null
    if (this.availableExpressions.has(name)) return name
    const lower = name.toLowerCase()
    if (this.availableExpressions.has(lower)) return lower
    const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
    if (this.availableExpressions.has(capitalized)) return capitalized
    if (this.currentVrm.expressionManager.getExpression(name)) return name
    return null
  }

  private applyStateVisuals(state: AssistantState): void {
    const palette = STATE_PALETTES[state] || STATE_PALETTES.idle
    const primaryColor = new THREE.Color(palette.primary)
    const glowColor = new THREE.Color(palette.glow)

    // Update lights
    this.ambientLight.intensity = palette.ambientIntensity
    this.rimLight.color.copy(primaryColor)
    this.frontLight.color.copy(glowColor)

    // Update procedural fallback materials
    if (this.coreMesh.material instanceof THREE.MeshStandardMaterial) {
      this.coreMesh.material.emissive.copy(primaryColor)
    }
    if (this.wireframeMesh.material instanceof THREE.MeshBasicMaterial) {
      this.wireframeMesh.material.color.copy(primaryColor)
    }
    if (this.ring1.material instanceof THREE.MeshStandardMaterial) {
      this.ring1.material.color.copy(primaryColor)
      this.ring1.material.emissive.copy(primaryColor)
    }
    if (this.ring2.material instanceof THREE.MeshStandardMaterial) {
      this.ring2.material.color.copy(glowColor)
      this.ring2.material.emissive.copy(glowColor)
    }
    if (this.ring3.material instanceof THREE.MeshStandardMaterial) {
      this.ring3.material.color.copy(primaryColor)
      this.ring3.material.emissive.copy(primaryColor)
    }
    if (this.particles.material instanceof THREE.PointsMaterial) {
      this.particles.material.color.copy(primaryColor)
    }
  }

  /**
   * Loads a local VRM model safely from an ArrayBuffer or validated local file.
   * Performs binary header validation, humanoid mapping checks, and expression discovery.
   * Strictly avoids automatic or arbitrary remote URL downloads.
   */
  public async loadModelFromBuffer(buffer: ArrayBuffer, modelName: string = 'Custom VRM'): Promise<void> {
    // 1. Normalize buffer to the active execution realm's ArrayBuffer
    let targetBuffer: ArrayBuffer = buffer
    if (typeof ArrayBuffer !== 'undefined' && !(buffer instanceof ArrayBuffer)) {
      const u8 = new Uint8Array(buffer as ArrayBuffer)
      const freshBuffer = new ArrayBuffer(u8.byteLength)
      new Uint8Array(freshBuffer).set(u8)
      targetBuffer = freshBuffer
    }

    // 2. Validate buffer length
    if (!targetBuffer || targetBuffer.byteLength < 12) {
      const err = 'Invalid model file: Buffer too small to be a valid glTF/VRM file'
      this.handleLoadError(err)
      throw new Error(err)
    }

    // 3. Validate glTF binary magic: 0x46546C67 ('glTF')
    const dataView = new DataView(targetBuffer)
    const magic = dataView.getUint32(0, true)
    if (magic !== 0x46546C67) {
      const err = 'Invalid model format: File header does not match binary glTF (VRM)'
      this.handleLoadError(err)
      throw new Error(err)
    }

    this.lastLoadedBuffer = targetBuffer

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    return new Promise((resolve, reject) => {
      try {
        loader.parse(
          targetBuffer,
          '',
          (gltf) => {
            try {
              const vrm: VRM = gltf.userData.vrm
              if (!vrm) {
                throw new Error('GLTF file does not contain valid VRM metadata')
              }

              // 3. Validate humanoid mappings
              if (!vrm.humanoid) {
                throw new Error('VRM file lacks humanoid bone definition')
              }

              const head = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
              const chest = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest)
              const spine = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine)
              if (!head && !chest && !spine) {
                console.warn('[CharacterController] Model does not define standard Head, Chest, or Spine bones.')
              }

              // 4. Discover and cache supported expressions
              this.availableExpressions.clear()
              if (vrm.expressionManager) {
                const exprMap = vrm.expressionManager.expressionMap
                if (exprMap) {
                  for (const key of Object.keys(exprMap)) {
                    this.availableExpressions.add(key)
                  }
                }
                const standardPresets: VRMExpressionPresetName[] = [
                  VRMExpressionPresetName.Aa,
                  VRMExpressionPresetName.Ih,
                  VRMExpressionPresetName.Ou,
                  VRMExpressionPresetName.Ee,
                  VRMExpressionPresetName.Oh,
                  VRMExpressionPresetName.Blink,
                  VRMExpressionPresetName.Happy,
                  VRMExpressionPresetName.Angry,
                  VRMExpressionPresetName.Sad,
                  VRMExpressionPresetName.Relaxed,
                  VRMExpressionPresetName.Surprised,
                  VRMExpressionPresetName.Neutral,
                  VRMExpressionPresetName.BlinkLeft,
                  VRMExpressionPresetName.BlinkRight,
                  VRMExpressionPresetName.LookUp,
                  VRMExpressionPresetName.LookDown,
                  VRMExpressionPresetName.LookLeft,
                  VRMExpressionPresetName.LookRight
                ]
                for (const preset of standardPresets) {
                  if (vrm.expressionManager.getExpression(preset)) {
                    this.availableExpressions.add(preset)
                  }
                }
              }

              // 5. Extract metadata
              const meta = vrm.meta
              const metaTitle =
                (meta as unknown as { name?: string; title?: string })?.name ||
                (meta as unknown as { name?: string; title?: string })?.title ||
                modelName
              const metaAuthor =
                (meta as unknown as { authors?: string[]; author?: string })?.authors?.join(', ') ||
                (meta as unknown as { authors?: string[]; author?: string })?.author ||
                'Unknown Author'
              const metaVersion =
                (meta as unknown as { metaVersion?: string })?.metaVersion || 'VRM 1.0/0.0'

              this.vrmMetaInfo = {
                title: metaTitle,
                author: metaAuthor,
                metaVersion: metaVersion
              }

              // Clean up existing VRM if any
              this.unloadVrm()

              // Handle VRM 0.0 rotation adjustment
              VRMUtils.rotateVRM0(vrm)

              this.currentVrm = vrm
              this.scene.add(vrm.scene)

              // Optimize humanoid pose: bring arms down to natural rest angle if in T-pose
              if (vrm.humanoid) {
                const leftUpperArm = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
                const rightUpperArm = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
                if (leftUpperArm) {
                  leftUpperArm.rotation.z = -1.15
                }
                if (rightUpperArm) {
                  rightUpperArm.rotation.z = 1.15
                }
              }

              // Adjust camera to frame avatar head/bust gracefully
              this.adjustCameraForVrm(vrm)

              // Hide procedural fallback
              this.proceduralGroup.visible = false
              this.mode = 'vrm'

              this.notifyTelemetry({
                modelName: metaTitle,
                mode: 'vrm',
                error: null,
                expressionsCount: this.availableExpressions.size,
                availableExpressions: Array.from(this.availableExpressions),
                vrmMeta: this.vrmMetaInfo,
                lipSyncMode: 'amplitude-spectral'
              })
              resolve()
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              this.handleLoadError(errMsg)
              reject(new Error(errMsg))
            }
          },
          (error) => {
            const errMsg = error instanceof Error ? error.message : 'Failed to parse VRM file structure'
            this.handleLoadError(errMsg)
            reject(new Error(errMsg))
          }
        )
      } catch (parseErr) {
        const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)
        this.handleLoadError(errMsg)
        reject(new Error(errMsg))
      }
    })
  }

  private adjustCameraForVrm(vrm: VRM): void {
    // Ensure world transformations are computed
    vrm.scene.updateMatrixWorld(true)

    let headY = 1.4
    if (vrm.humanoid) {
      const headBone = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
      if (headBone) {
        const headWorldPos = new THREE.Vector3()
        headBone.getWorldPosition(headWorldPos)
        if (headWorldPos.y > 0.4) {
          headY = headWorldPos.y
        }
      }
    } else {
      const bbox = new THREE.Box3().setFromObject(vrm.scene)
      if (!bbox.isEmpty()) {
        headY = bbox.max.y * 0.9
      }
    }

    // Position camera focused on upper bust and face
    this.camera.position.set(0, headY - 0.05, 1.15)
    this.camera.lookAt(0, headY - 0.1, 0)
  }

  public resetToProceduralFallback(): void {
    this.unloadVrm()
    this.availableExpressions.clear()
    this.vrmMetaInfo = undefined
    this.proceduralGroup.visible = true
    this.mode = 'procedural'
    this.camera.position.set(0, 0, 3.8)
    this.camera.lookAt(0, 0, 0)
    this.notifyTelemetry({
      modelName: 'Holographic Fallback Core',
      mode: 'procedural',
      error: null,
      expressionsCount: 0,
      availableExpressions: [],
      vrmMeta: undefined,
      lipSyncMode: 'amplitude-spectral'
    })
  }

  private unloadVrm(): void {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene)
      VRMUtils.deepDispose(this.currentVrm.scene)
      this.currentVrm = null
    }
  }

  private handleLoadError(errorText: string): void {
    console.error('[CharacterController] VRM Load Error:', errorText)
    this.resetToProceduralFallback()
    if (this.onError) {
      this.onError(errorText, 'vrm_load_failed')
    }
    this.notifyTelemetry({ error: errorText })
  }

  private notifyTelemetry(custom: Partial<CharacterTelemetry> = {}): void {
    if (!this.onTelemetry) return
    this.onTelemetry({
      mode: this.mode,
      modelName: this.mode === 'vrm' ? (this.vrmMetaInfo?.title || 'Custom VRM Model') : 'Holographic Fallback Core',
      state: this.currentState,
      isSpeaking: this.isSpeaking,
      fps: this.isPaused || this.isContextLost ? 0 : this.currentFps,
      error: null,
      expressionsCount: this.availableExpressions.size,
      availableExpressions: Array.from(this.availableExpressions),
      vrmMeta: this.vrmMetaInfo,
      lipSyncMode: 'amplitude-spectral',
      audioAmplitude: Math.round(this.currentAudioAmplitude * 100) / 100,
      gpuRenderer: this.activeGpuRenderer,
      gpuVendor: this.activeGpuVendor,
      webgl2Available: !this.isContextLost && this.renderer !== null,
      rendererReady: this.renderer !== null && !this.isContextLost,
      avatarVisible: this.avatarVisible,
      contextLostCount: this.contextLostCount,
      ...custom
    })
  }

  public renderFrame(): void {
    this.timer.update()
    const delta = Math.min(this.timer.getDelta(), 0.1) // Cap delta to prevent explosion on tab resume
    const elapsedTime = this.timer.getElapsed()

    // 1. Procedural Fallback Animation
    if (this.mode === 'procedural' && this.proceduralGroup.visible) {
      this.animateProcedural(delta, elapsedTime)
    }

    // 2. VRM Character Animation
    if (this.mode === 'vrm' && this.currentVrm) {
      this.animateVrm(delta, elapsedTime)
    }

    // 3. Render
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera)
    }
  }

  // --- Animation Loop ---
  private animate = (): void => {
    if (!this.renderer || this.isPaused || this.isDisposed || this.isContextLost) return
    this.animFrameId = requestAnimationFrame(this.animate)

    this.renderFrame()

    // Mark avatar visible on first successful frame render
    if (!this.avatarVisible) {
      this.avatarVisible = true
      this.notifyTelemetry({ avatarVisible: true })
    }

    // Reset recovery attempts after stable continuous rendering for 5 seconds
    this.stableRenderTimer += 0.016
    if (this.stableRenderTimer >= 5.0 && this.recoveryAttempts > 0) {
      this.recoveryAttempts = 0
    }

    // Measure FPS
    this.frameCount++
    const now = performance.now()
    if (now - this.lastFpsCheck >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCheck))
      this.frameCount = 0
      this.lastFpsCheck = now
      this.notifyTelemetry({ fps: this.currentFps })
    }
  }

  private updateAudioAnalysis(isActuallySpeaking: boolean, elapsed: number): void {
    if (this.audioAnalyser && this.audioFreqData) {
      this.audioAnalyser.getByteFrequencyData(this.audioFreqData)
      let sum = 0
      for (let i = 0; i < this.audioFreqData.length; i++) {
        sum += this.audioFreqData[i]
      }
      const rawAmp = sum / (this.audioFreqData.length * 255)
      this.currentAudioAmplitude = rawAmp

      if (rawAmp > 0.02) {
        // Low band (~100-350Hz) -> 'Oh'
        let lowSum = 0
        const lowBins = Math.min(5, this.audioFreqData.length)
        for (let i = 1; i < lowBins; i++) lowSum += this.audioFreqData[i]
        const lowEnergy = lowSum / ((lowBins - 1) * 255)

        // Mid band (~350-1500Hz) -> 'Aa'
        let midSum = 0
        const midStart = 5
        const midEnd = Math.min(20, this.audioFreqData.length)
        for (let i = midStart; i < midEnd; i++) midSum += this.audioFreqData[i]
        const midEnergy = midSum / ((midEnd - midStart) * 255)

        // High band (~1500-4000Hz) -> 'Ih'
        let highSum = 0
        const highStart = 20
        const highEnd = Math.min(45, this.audioFreqData.length)
        for (let i = highStart; i < highEnd; i++) highSum += this.audioFreqData[i]
        const highEnergy = highSum / ((highEnd - highStart) * 255)

        const boost = Math.min(1.0, rawAmp * 3.5)
        this.targetVisemeAa = Math.min(1.0, midEnergy * 3.0 * boost)
        this.targetVisemeOh = Math.min(0.8, lowEnergy * 2.5 * boost)
        this.targetVisemeIh = Math.min(0.7, highEnergy * 2.2 * boost)
      } else {
        this.targetVisemeAa = 0
        this.targetVisemeOh = 0
        this.targetVisemeIh = 0
      }
    } else if (isActuallySpeaking) {
      // Procedural modulation fallback when Web Audio Analyser is not connected
      const amp = (Math.sin(elapsed * 12) * 0.5 + 0.5) * 0.75 + (Math.sin(elapsed * 18) * 0.25 + 0.25) * 0.25
      this.currentAudioAmplitude = amp
      this.targetVisemeAa = amp * 0.8
      this.targetVisemeOh = amp * 0.25
      this.targetVisemeIh = 0
    } else {
      this.currentAudioAmplitude = 0
      this.targetVisemeAa = 0
      this.targetVisemeOh = 0
      this.targetVisemeIh = 0
    }
  }

  private animateProcedural(delta: number, elapsed: number): void {
    // Dynamic ring rotations responsive to assistant state
    let speedMult = 1.0
    if (this.currentState === 'thinking') speedMult = 3.2
    if (this.currentState === 'executing') speedMult = 2.4
    if (this.currentState === 'listening') speedMult = 1.6
    if (this.currentState === 'error') speedMult = 0.5

    if (this.reducedMotion) {
      speedMult *= 0.25
    }

    this.ring1.rotation.z += delta * 0.45 * speedMult
    this.ring1.rotation.x += delta * 0.25 * speedMult

    this.ring2.rotation.y += delta * 0.6 * speedMult
    this.ring2.rotation.z -= delta * 0.35 * speedMult

    this.ring3.rotation.x -= delta * 0.4 * speedMult
    this.ring3.rotation.y += delta * 0.3 * speedMult

    // Particle field slow drift
    this.particles.rotation.y += delta * (this.reducedMotion ? 0.02 : 0.08)

    // Audio/speech wave reactivity on core
    const isActuallySpeaking = this.isSpeaking || this.currentState === 'speaking' || this.currentState === 'responding'
    this.updateAudioAnalysis(isActuallySpeaking, elapsed)

    let targetScale = 1.0
    if (this.currentAudioAmplitude > 0.03) {
      targetScale = 1.0 + Math.min(0.25, this.currentAudioAmplitude * 0.5)
    } else if (isActuallySpeaking) {
      targetScale = 1.0 + Math.sin(elapsed * 12.0) * 0.08 + Math.cos(elapsed * 7.5) * 0.04
    } else {
      targetScale = 1.0 + (this.reducedMotion ? 0 : Math.sin(elapsed * 1.5) * 0.02)
    }
    this.coreMesh.scale.setScalar(targetScale)
    this.wireframeMesh.scale.setScalar(targetScale * 1.06)

    // Subtle gentle core float
    this.proceduralGroup.position.y = this.reducedMotion ? 0 : Math.sin(elapsed * 1.2) * 0.04
  }

  private animateVrm(delta: number, elapsed: number): void {
    const vrm = this.currentVrm
    if (!vrm) return

    const motionScale = this.reducedMotion ? 0.2 : 1.0

    // 1. Idle breathing and micro-swaying on humanoid bones
    if (vrm.humanoid) {
      const chest = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest)
      const spine = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine)
      const head = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)

      const breath = Math.sin(elapsed * 1.8) * 0.012 * motionScale
      if (chest) chest.rotation.x = breath
      if (spine) spine.rotation.x = breath * 0.5

      // State-specific head tilt / posture
      let headRotX = Math.sin(elapsed * 0.8) * 0.015 * motionScale
      let headRotY = Math.cos(elapsed * 0.6) * 0.02 * motionScale
      let headRotZ = 0

      switch (this.currentState) {
        case 'listening':
          // Attentive forward inclination & slight tilt towards user
          headRotZ = 0.05
          headRotX = -0.04
          headRotY = 0.02
          if (chest) chest.rotation.x = breath + 0.02
          break
        case 'thinking':
          // Head tilted up and sideways in reflection
          headRotZ = -0.06
          headRotX = 0.08
          headRotY = 0.10
          break
        case 'waiting_confirmation':
          headRotZ = 0.08
          headRotX = 0.02
          break
        case 'speaking':
        case 'responding':
          // Subtle natural rhythmic head accent nodding while speaking
          headRotX += Math.sin(elapsed * 4.0) * 0.025 * motionScale
          headRotY += Math.sin(elapsed * 2.5) * 0.015 * motionScale
          break
        case 'executing':
          // Focused upright posture
          headRotX = -0.02
          headRotY = 0
          headRotZ = 0
          if (chest) chest.rotation.x = 0.01
          break
        case 'error':
          // Lowered head in remorse/interrupted state
          headRotX = 0.08
          headRotZ = 0.02
          break
      }

      if (head) {
        head.rotation.x = headRotX
        head.rotation.y = headRotY
        head.rotation.z = headRotZ
      }
    }

    // 2. Procedural Blinking
    this.blinkTimer += delta
    if (!this.isBlinking && this.blinkTimer >= this.nextBlinkInterval) {
      this.isBlinking = true
      this.blinkTimer = 0
      this.blinkProgress = 0
      this.nextBlinkInterval = 3.0 + Math.random() * 3.0 // 3-6 second natural interval
    }

    if (this.isBlinking) {
      this.blinkProgress += delta / 0.16 // Blink lasts ~160ms
      let blinkWeight = 0
      if (this.blinkProgress <= 0.5) {
        blinkWeight = this.blinkProgress * 2
      } else if (this.blinkProgress <= 1.0) {
        blinkWeight = (1.0 - this.blinkProgress) * 2
      } else {
        this.isBlinking = false
        blinkWeight = 0
      }

      this.safeSetExpression(VRMExpressionPresetName.Blink, blinkWeight)
    }

    // 3. Speaking Mouth Movement Synchronization (Amplitude & Spectrum)
    const isActuallySpeaking = this.isSpeaking || this.currentState === 'speaking' || this.currentState === 'responding'
    this.updateAudioAnalysis(isActuallySpeaking, elapsed)

    const lerpSpeed = delta * 18
    this.currentVisemeAa = THREE.MathUtils.lerp(this.currentVisemeAa, this.targetVisemeAa, lerpSpeed)
    this.currentVisemeOh = THREE.MathUtils.lerp(this.currentVisemeOh, this.targetVisemeOh, lerpSpeed)
    this.currentVisemeIh = THREE.MathUtils.lerp(this.currentVisemeIh, this.targetVisemeIh, lerpSpeed)

    this.safeSetExpression(VRMExpressionPresetName.Aa, this.currentVisemeAa)
    this.safeSetExpression(VRMExpressionPresetName.Oh, this.currentVisemeOh)
    if (this.availableExpressions.has(VRMExpressionPresetName.Ih)) {
      this.safeSetExpression(VRMExpressionPresetName.Ih, this.currentVisemeIh)
    }

    // 4. State-Driven Facial Expressions (Defensive checks)
    const isHappy = this.currentState === 'idle'
    const isRelaxed = this.currentState === 'listening'
    const isSurprised = this.currentState === 'waiting_confirmation'
    const isSad = this.currentState === 'error'
    const isExecuting = this.currentState === 'executing'

    this.safeSetExpression(VRMExpressionPresetName.Happy, isHappy ? 0.2 : 0)
    this.safeSetExpression(VRMExpressionPresetName.Relaxed, isRelaxed ? 0.35 : 0)
    this.safeSetExpression(VRMExpressionPresetName.Surprised, isSurprised ? 0.4 : 0)
    this.safeSetExpression(VRMExpressionPresetName.Sad, isSad ? 0.5 : 0)
    if (isExecuting) {
      this.safeSetExpression(VRMExpressionPresetName.Neutral, 1.0)
    }

    // 5. Update VRM spring bones and constraints
    vrm.update(delta)
  }

  // --- Teardown & Resource Disposal ---
  public dispose(): void {
    this.isDisposed = true

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }

    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored)

    document.removeEventListener('visibilitychange', this.handleVisibilityChange)

    if (this.mediaQueryList && this.mediaQueryListener) {
      this.mediaQueryList.removeEventListener('change', this.mediaQueryListener)
      this.mediaQueryList = null
      this.mediaQueryListener = null
    }

    this.audioAnalyser = null
    this.audioFreqData = null

    this.unloadVrm()

    // Dispose procedural fallback geometries and materials
    this.coreMesh.geometry.dispose()
    if (Array.isArray(this.coreMesh.material)) {
      this.coreMesh.material.forEach((m) => m.dispose())
    } else {
      this.coreMesh.material.dispose()
    }

    this.wireframeMesh.geometry.dispose()
    if (this.wireframeMesh.material instanceof THREE.Material) {
      this.wireframeMesh.material.dispose()
    }

    this.ring1.geometry.dispose()
    if (this.ring1.material instanceof THREE.Material) this.ring1.material.dispose()

    this.ring2.geometry.dispose()
    if (this.ring2.material instanceof THREE.Material) this.ring2.material.dispose()

    this.ring3.geometry.dispose()
    if (this.ring3.material instanceof THREE.Material) this.ring3.material.dispose()

    this.particles.geometry.dispose()
    if (this.particles.material instanceof THREE.Material) this.particles.material.dispose()

    // Dispose renderer cleanly without forcing context loss (Phase 5)
    if (this.renderer) {
      try {
        this.renderer.dispose()
      } catch {
        // Ignore teardown errors
      }
      this.renderer = null
    }
  }
}
