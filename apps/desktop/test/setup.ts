import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock WebGLRenderer for headless jsdom test environment
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()
  class MockWebGLRenderer {
    domElement: HTMLCanvasElement
    outputColorSpace: string = ''
    constructor(options: { canvas?: HTMLCanvasElement } = {}) {
      this.domElement = options.canvas || document.createElement('canvas')
    }
    setPixelRatio = vi.fn()
    setSize = vi.fn()
    render = vi.fn()
    dispose = vi.fn()
    forceContextLoss = vi.fn()
    getContext = vi.fn().mockReturnValue(null)
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer
  }
})

// Mock HTMLCanvasElement.prototype.getContext for headless jsdom WebGL tests
if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) {
  const origGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (contextId: string, ...args: any[]) {
    try {
      const res = origGetContext.apply(this, [contextId, ...args] as any)
      if (res) return res
    } catch {
      // jsdom throws "Not implemented"
    }
    if (contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl') {
      const mockGl = {
        canvas: this,
        isContextLost: () => false,
        getExtension: vi.fn().mockReturnValue(null),
        VERSION: 0x1F02,
        SHADING_LANGUAGE_VERSION: 0x8B8C,
        VENDOR: 0x1F00,
        RENDERER: 0x1F01,
        MAX_TEXTURE_IMAGE_UNITS: 0x8872,
        MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
        MAX_VERTEX_ATTRIBS: 0x8869,
        MAX_TEXTURE_SIZE: 0x0D33,
        VERTEX_SHADER: 0x8B31,
        FRAGMENT_SHADER: 0x8B30,
        HIGH_FLOAT: 0x8DF2,
        MEDIUM_FLOAT: 0x8DF1,
        LOW_FLOAT: 0x8DF0,
        getParameter: vi.fn((pname: number) => {
          if (pname === 0x1F02) return 'WebGL 2.0 (Mock Test Context)'
          if (pname === 0x1F01) return 'Mock NVIDIA GeForce RTX 3050'
          if (pname === 0x1F00) return 'Mock NVIDIA'
          if (pname === 0x0D33) return 4096
          if (pname === 0x8869) return 16
          return 0
        }),
        getShaderPrecisionFormat: vi.fn().mockReturnValue({
          precision: 23,
          rangeMin: 127,
          rangeMax: 127
        }),
        getContextAttributes: vi.fn().mockReturnValue({
          alpha: true,
          antialias: false,
          powerPreference: 'high-performance'
        })
      }
      return mockGl as any
    }
    return null
  }
}

// Mock createImageBitmap for GLTF texture parsing in headless jsdom
if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'undefined') {
  window.createImageBitmap = vi.fn().mockResolvedValue({
    width: 256,
    height: 256,
    close: vi.fn(),
  }) as unknown as typeof createImageBitmap
}
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = vi.fn().mockResolvedValue({
    width: 256,
    height: 256,
    close: vi.fn(),
  }) as unknown as typeof createImageBitmap
}

// Mock scrollIntoView for jsdom environment
window.HTMLElement.prototype.scrollIntoView = vi.fn()

// Mock global Audio for speech playback testing
class MockAudio {
  src: string = ''
  volume: number = 1.0
  onplay: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null

  play() {
    if (this.onplay) this.onplay()
    return Promise.resolve()
  }
  pause() {}
}
// @ts-expect-error Mocking global Audio constructor
window.Audio = MockAudio

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [
        {
          stop: vi.fn(),
          kind: 'audio',
        },
      ],
    }),
  },
  writable: true,
})

// Mock MediaRecorder
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(true)
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob([new Uint8Array(256)], { type: 'audio/webm' }) })
    }
    if (this.onstop) {
      this.onstop()
    }
  }
}
// @ts-expect-error Mocking MediaRecorder constructor
window.MediaRecorder = MockMediaRecorder

// Mock URL.createObjectURL and revokeObjectURL
window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-audio-url')
window.URL.revokeObjectURL = vi.fn()

// Mock global fetch for local FastAPI backend
global.fetch = vi.fn().mockImplementation((url: string) => {
  if (url.includes('/api/system/status')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          backend_status: 'ready',
          ollama: {
            connected: true,
            base_url: 'http://127.0.0.1:11434',
            available_models: ['qwen3.5:4b'],
            model_installed: true,
            active_model: 'qwen3.5:4b',
            error_message: null,
          },
          voice: {
            enabled: true,
            stt: {
              engine: 'faster-whisper',
              available: true,
              model: 'base.en',
              device: 'cpu',
              error: null,
            },
            tts: {
              engine: 'piper-tts',
              available: true,
              model_path: 'models/piper/en_US-lessac-medium.onnx',
              error: null,
            },
          },
          database: 'sqlite+aiosqlite (connected)',
          host: '127.0.0.1',
          port: 8000,
        }),
    })
  }

  if (url.includes('/api/voice/status')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          enabled: true,
          stt: {
            engine: 'faster-whisper',
            available: true,
            model: 'base.en',
            device: 'cpu',
            error: null,
          },
          tts: {
            engine: 'piper-tts',
            available: true,
            model_path: 'models/piper/en_US-lessac-medium.onnx',
            error: null,
          },
        }),
    })
  }

  if (url.includes('/api/voice/transcribe')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          text: 'Hello AURA this is a spoken prompt.',
          language: 'en',
          duration_seconds: 1.5,
        }),
    })
  }

  if (url.includes('/api/voice/synthesize')) {
    return Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'audio/wav' }),
      blob: () => Promise.resolve(new Blob(['fake-wav-data'], { type: 'audio/wav' })),
    })
  }

  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  })
})

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
window.ResizeObserver = MockResizeObserver

// Mock Electron preload bridge for renderer testing
Object.defineProperty(window, 'auraAPI', {
  value: {
    getSystemStatus: vi.fn().mockResolvedValue({
      ollama: 'connected',
      backend: 'ready',
      activeModel: 'qwen3.5:4b',
      memoryMb: 142,
      micReady: true,
    }),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    selectVrmFile: vi.fn().mockResolvedValue('C:\\Projects\\AURA\\models\\vrm\\avatar.vrm'),
    saveVrmCharacter: vi.fn().mockImplementation((p: string) => Promise.resolve(`C:\\Users\\user\\AppData\\Roaming\\aura\\characters\\${p.split(/[/\\]/).pop()}`)),
    getStoredVrmCharacter: vi.fn().mockResolvedValue(null),
    resetVrmCharacter: vi.fn().mockResolvedValue(undefined),
    getGpuDiagnostics: vi.fn().mockResolvedValue({
      hardwareAccelerationEnabled: true,
      featureStatus: { gpu_compositing: 'enabled_on', webgl: 'enabled_on', webgl2: 'enabled_on' },
      gpuInfo: { basic: true }
    }),
    loadVrmBinary: vi.fn().mockImplementation((filePath: string) => {
      if (filePath.includes('invalid') || filePath.includes('corrupt')) {
        return Promise.reject(new Error('VRM file does not exist or is corrupted'))
      }
      try {
        const fs = require('fs')
        const path = require('path')
        const candidate = path.resolve('models/vrm/aura.vrm')
        if (fs.existsSync(candidate)) {
          const buf = fs.readFileSync(candidate)
          return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        }
      } catch {
        // Fallback
      }
      return Promise.resolve(new ArrayBuffer(1024))
    }),
  },
  writable: true,
})

// Automatically cleanup DOM after each test
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
