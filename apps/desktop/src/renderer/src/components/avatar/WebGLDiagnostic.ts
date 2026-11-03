import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  VRM,
  VRMLoaderPlugin,
  VRMExpressionPresetName,
  VRMHumanBoneName
} from '@pixiv/three-vrm'
import { patchWebGLPrototypesSafely, wrapWebGLContextInstance } from './CharacterController'

/**
 * Phase 3 Conservative WebGL Attributes:
 * - antialias: false (disables MSAA to avoid msaa_is_slow / EGL version mismatch)
 * - powerPreference: 'high-performance' (signals GPU driver to switch to discrete NVIDIA RTX 3050)
 * - depth: true, stencil: false (avoids unnecessary stencil buffer allocation)
 * - preserveDrawingBuffer: false (enables zero-copy compositing)
 */
export const CONSERVATIVE_WEBGL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  depth: true,
  stencil: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
  desynchronized: false,
  failIfMajorPerformanceCaveat: false
}

export interface WebGLDiagnosticReport {
  isSupported: boolean
  webglVersion: string
  glRenderer: string
  glVendor: string
  unmaskedRenderer: string
  unmaskedVendor: string
  maxTextureSize: number
  maxVertexAttribs: number
  isHighPerformance: boolean
  isContextLost: boolean
  contextAttributes: WebGLContextAttributes | null
  error?: string
}

export interface StageTestResult {
  stage: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  name: string
  success: boolean
  error?: string
  details?: Record<string, unknown>
}

export interface IsolatedPipelineReport {
  stages: StageTestResult[]
  allPassed: boolean
  failedStage?: string
  activeGpuRenderer?: string
}

/**
 * Phase 2: Independent WebGL2 capability diagnostic
 */
export function runWebGL2Diagnostic(canvas: HTMLCanvasElement): WebGLDiagnosticReport {
  patchWebGLPrototypesSafely()

  if (typeof window === 'undefined' || !window.WebGL2RenderingContext) {
    return {
      isSupported: false,
      webglVersion: 'None',
      glRenderer: 'None',
      glVendor: 'None',
      unmaskedRenderer: 'None',
      unmaskedVendor: 'None',
      maxTextureSize: 0,
      maxVertexAttribs: 0,
      isHighPerformance: false,
      isContextLost: false,
      contextAttributes: null,
      error: 'WebGL2RenderingContext is not defined in this environment.'
    }
  }

  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', CONSERVATIVE_WEBGL_ATTRIBUTES)
  } catch (e) {
    return {
      isSupported: false,
      webglVersion: 'None',
      glRenderer: 'None',
      glVendor: 'None',
      unmaskedRenderer: 'None',
      unmaskedVendor: 'None',
      maxTextureSize: 0,
      maxVertexAttribs: 0,
      isHighPerformance: false,
      isContextLost: false,
      contextAttributes: null,
      error: `getContext exception: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  if (!gl) {
    return {
      isSupported: false,
      webglVersion: 'None',
      glRenderer: 'None',
      glVendor: 'None',
      unmaskedRenderer: 'None',
      unmaskedVendor: 'None',
      maxTextureSize: 0,
      maxVertexAttribs: 0,
      isHighPerformance: false,
      isContextLost: false,
      contextAttributes: null,
      error: 'canvas.getContext("webgl2") returned null.'
    }
  }

  const isContextLost = gl.isContextLost()
  const version = (gl.getParameter(gl.VERSION) as string) || 'Unknown WebGL'
  const renderer = (gl.getParameter(gl.RENDERER) as string) || 'Unknown Renderer'
  const vendor = (gl.getParameter(gl.VENDOR) as string) || 'Unknown Vendor'
  const maxTextureSize = (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 0
  const maxVertexAttribs = (gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number) || 0
  const attrs = gl.getContextAttributes()

  let unmaskedRenderer = renderer
  let unmaskedVendor = vendor
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  if (debugInfo) {
    const unmaskedR = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    if (typeof unmaskedR === 'string') unmaskedRenderer = unmaskedR
    const unmaskedV = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
    if (typeof unmaskedV === 'string') unmaskedVendor = unmaskedV
  }

  const isHighPerformance =
    unmaskedRenderer.toLowerCase().includes('nvidia') ||
    unmaskedRenderer.toLowerCase().includes('geforce') ||
    unmaskedRenderer.toLowerCase().includes('rtx') ||
    unmaskedRenderer.toLowerCase().includes('discrete')

  return {
    isSupported: !isContextLost,
    webglVersion: version,
    glRenderer: renderer,
    glVendor: vendor,
    unmaskedRenderer,
    unmaskedVendor,
    maxTextureSize,
    maxVertexAttribs,
    isHighPerformance,
    isContextLost,
    contextAttributes: attrs
  }
}

/**
 * Phase 4: Isolated Rendering Pipeline Tests (Stages A through G)
 */
export async function runIsolatedRenderingPipeline(
  testCanvas: HTMLCanvasElement,
  vrmBuffer?: ArrayBuffer
): Promise<IsolatedPipelineReport> {
  patchWebGLPrototypesSafely()
  const stages: StageTestResult[] = []

  let gl: WebGL2RenderingContext | null = null
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let cubeMesh: THREE.Mesh | null = null
  let proceduralMesh: THREE.Mesh | null = null
  let vrmInstance: VRM | null = null

  // Helper to append stage result
  const recordStage = (stage: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', name: string, success: boolean, err?: string, details?: Record<string, unknown>) => {
    stages.push({ stage, name, success, error: err, details })
  }

  try {
    // Stage A: Create WebGL2 Context
    try {
      gl = testCanvas.getContext('webgl2', CONSERVATIVE_WEBGL_ATTRIBUTES)
      if (!gl || gl.isContextLost()) {
        throw new Error('WebGL2 context creation failed or context is lost.')
      }
      wrapWebGLContextInstance(gl)
      recordStage('A', 'WebGL2 Context Creation', true, undefined, {
        version: gl.getParameter(gl.VERSION)
      })
    } catch (err) {
      recordStage('A', 'WebGL2 Context Creation', false, err instanceof Error ? err.message : String(err))
      return { stages, allPassed: false, failedStage: 'A' }
    }

    // Stage B: Initialize Minimal Three.js Renderer
    try {
      scene = new THREE.Scene()
      camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
      camera.position.set(0, 0, 3)

      renderer = new THREE.WebGLRenderer({
        canvas: testCanvas,
        context: gl || undefined,
        alpha: true,
        antialias: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        precision: 'highp'
      })
      renderer.setSize(256, 256, false)
      renderer.setPixelRatio(1.0)
      recordStage('B', 'Three.js Scene & Conservative Renderer Setup', true)
    } catch (err) {
      recordStage('B', 'Three.js Scene & Conservative Renderer Setup', false, err instanceof Error ? err.message : String(err))
      return { stages, allPassed: false, failedStage: 'B' }
    }

    // Stage C: Render One Cube
    try {
      const cubeGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5)
      const cubeMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe })
      cubeMesh = new THREE.Mesh(cubeGeo, cubeMat)
      scene.add(cubeMesh)

      renderer.render(scene, camera)
      scene.remove(cubeMesh)
      cubeGeo.dispose()
      cubeMat.dispose()
      recordStage('C', 'Render Single Primitive (Cube)', true)
    } catch (err) {
      recordStage('C', 'Render Single Primitive (Cube)', false, err instanceof Error ? err.message : String(err))
      return { stages, allPassed: false, failedStage: 'C' }
    }

    // Stage D: Render Minimal Procedural Avatar
    try {
      const coreGeo = new THREE.IcosahedronGeometry(0.4, 1)
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x2cb67d, wireframe: true })
      proceduralMesh = new THREE.Mesh(coreGeo, coreMat)
      scene.add(proceduralMesh)

      renderer.render(scene, camera)
      scene.remove(proceduralMesh)
      coreGeo.dispose()
      coreMat.dispose()
      recordStage('D', 'Render Procedural Avatar Core', true)
    } catch (err) {
      recordStage('D', 'Render Procedural Avatar Core', false, err instanceof Error ? err.message : String(err))
      return { stages, allPassed: false, failedStage: 'D' }
    }

    // Stage E: Load VRM Model (if buffer provided)
    if (vrmBuffer && vrmBuffer.byteLength >= 12) {
      try {
        const u8 = new Uint8Array(vrmBuffer)
        const cleanBuffer = new ArrayBuffer(u8.byteLength)
        new Uint8Array(cleanBuffer).set(u8)

        const loader = new GLTFLoader()
        loader.register((parser) => new VRMLoaderPlugin(parser))

        vrmInstance = await new Promise<VRM>((resolve, reject) => {
          loader.parse(
            cleanBuffer,
            '',
            (gltf) => {
              const vrm = gltf.userData.vrm as VRM
              if (!vrm) {
                reject(new Error('GLTF payload lacks VRM root metadata.'))
                return
              }
              if (!vrm.humanoid) {
                reject(new Error('VRM lacks humanoid bone mappings.'))
                return
              }
              resolve(vrm)
            },
            (err) => reject(err instanceof Error ? err : new Error(String(err)))
          )
        })

        scene.add(vrmInstance.scene)
        recordStage('E', 'Load & Validate VRM Model', true, undefined, {
          title: (vrmInstance.meta as any)?.name || (vrmInstance.meta as any)?.title || 'VRM Model',
          bones: vrmInstance.humanoid ? 'Humanoid verified' : 'Missing'
        })
      } catch (err) {
        recordStage('E', 'Load & Validate VRM Model', false, err instanceof Error ? err.message : String(err))
        return { stages, allPassed: false, failedStage: 'E' }
      }

      // Stage F: Add Facial Expressions
      try {
        if (vrmInstance.expressionManager) {
          vrmInstance.expressionManager.setValue(VRMExpressionPresetName.Happy, 0.2)
          vrmInstance.expressionManager.setValue(VRMExpressionPresetName.Blink, 0.5)
          vrmInstance.expressionManager.setValue(VRMExpressionPresetName.Aa, 0.8)
          vrmInstance.expressionManager.update()
        }
        recordStage('F', 'Apply Facial Expressions & Viseme Weights', true)
      } catch (err) {
        recordStage('F', 'Apply Facial Expressions & Viseme Weights', false, err instanceof Error ? err.message : String(err))
        return { stages, allPassed: false, failedStage: 'F' }
      }

      // Stage G: Enable Animation & Frame Render
      try {
        if (vrmInstance.humanoid) {
          const head = vrmInstance.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
          if (head) {
            head.rotation.y = 0.1
          }
        }
        vrmInstance.update(0.016)
        renderer.render(scene, camera)
        recordStage('G', 'Animation Tick & Frame Render', true)
      } catch (err) {
        recordStage('G', 'Animation Tick & Frame Render', false, err instanceof Error ? err.message : String(err))
        return { stages, allPassed: false, failedStage: 'G' }
      }
    } else {
      recordStage('E', 'Load VRM Model (Skipped - No buffer supplied)', true)
      recordStage('F', 'Facial Expressions (Skipped - No VRM)', true)
      recordStage('G', 'Animation Tick (Skipped - No VRM)', true)
    }

    return {
      stages,
      allPassed: true,
      activeGpuRenderer: renderer ? 'Active Three.js WebGL2 Context' : undefined
    }
  } finally {
    // Cleanup temporary resources cleanly without calling forceContextLoss()
    if (vrmInstance && scene) {
      scene.remove(vrmInstance.scene)
    }
    if (renderer) {
      try {
        renderer.dispose()
      } catch {
        // ignore
      }
    }
  }
}
