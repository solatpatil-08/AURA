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

export interface CharacterControllerOptions {
  onTelemetry?: (telemetry: Partial<CharacterTelemetry>) => void
  onError?: (error: string) => void
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
 * Isolated CharacterController managing Three.js canvas rendering,
 * procedural fallback graphics, and @pixiv/three-vrm character animation.
 *
 * Isolated completely from AI backend logic.
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

  // Speaking mouth loop
  private speechMouthOpen: number = 0

  // Telemetry & metrics
  private onTelemetry?: (telemetry: Partial<CharacterTelemetry>) => void
  private onError?: (error: string) => void
  private frameCount: number = 0
  private lastFpsCheck: number = 0
  private currentFps: number = 60

  constructor(canvas: HTMLCanvasElement, options: CharacterControllerOptions = {}) {
    this.canvas = canvas
    this.onTelemetry = options.onTelemetry
    this.onError = options.onError
    this.timer = new THREE.Timer()

    // 1. Initialize Three.js Scene
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 25)
    this.camera.position.set(0, 0, 3.8)

    // 2. Initialize WebGLRenderer with defensive error checking
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      })
      this.renderer.outputColorSpace = THREE.SRGBColorSpace
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    } catch (err) {
      const errMsg = `WebGL initialization failed: ${err instanceof Error ? err.message : String(err)}`
      console.error('[CharacterController]', errMsg)
      if (this.onError) this.onError(errMsg)
    }

    // 3. Initialize Lighting
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

    // 4. Construct Visually Striking Procedural Fallback 3D Character
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

    // 5. Setup visibility change listener to avoid background CPU/GPU usage
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test'
    const shouldAnimate = options.autoAnimate ?? !isTestEnv

    // 6. Start Render Loop
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
   * Never downloads arbitrary assets from untrusted remote URLs.
   */
  public async loadModelFromBuffer(buffer: ArrayBuffer, modelName: string = 'Custom VRM'): Promise<void> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    return new Promise((resolve, reject) => {
      try {
        loader.parse(
          buffer,
          '',
          (gltf) => {
            try {
              const vrm: VRM = gltf.userData.vrm
              if (!vrm) {
                throw new Error('GLTF file does not contain valid VRM metadata')
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

              this.notifyTelemetry({ modelName, mode: 'vrm', error: null })
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
    let headY = 1.4
    if (vrm.humanoid) {
      const headBone = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
      if (headBone) {
        const headWorldPos = new THREE.Vector3()
        headBone.getWorldPosition(headWorldPos)
        if (headWorldPos.y > 0.5) {
          headY = headWorldPos.y
        }
      }
    }
    // Position camera focused on upper bust and face
    this.camera.position.set(0, headY - 0.05, 1.15)
    this.camera.lookAt(0, headY - 0.1, 0)
  }

  public resetToProceduralFallback(): void {
    this.unloadVrm()
    this.proceduralGroup.visible = true
    this.mode = 'procedural'
    this.camera.position.set(0, 0, 3.8)
    this.camera.lookAt(0, 0, 0)
    this.notifyTelemetry({ modelName: 'Holographic Fallback Core', mode: 'procedural', error: null })
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
      this.onError(errorText)
    }
    this.notifyTelemetry({ error: errorText })
  }

  private notifyTelemetry(custom: Partial<CharacterTelemetry> = {}): void {
    if (!this.onTelemetry) return
    this.onTelemetry({
      mode: this.mode,
      modelName: this.mode === 'vrm' ? 'Custom VRM Model' : 'Holographic Fallback Core',
      state: this.currentState,
      isSpeaking: this.isSpeaking,
      fps: this.currentFps,
      error: null,
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
    if (!this.renderer || this.isPaused) return
    this.animFrameId = requestAnimationFrame(this.animate)

    this.renderFrame()

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

  private animateProcedural(delta: number, elapsed: number): void {
    // Dynamic ring rotations responsive to assistant state
    let speedMult = 1.0
    if (this.currentState === 'thinking') speedMult = 3.2
    if (this.currentState === 'executing') speedMult = 2.4
    if (this.currentState === 'listening') speedMult = 1.6
    if (this.currentState === 'error') speedMult = 0.5

    this.ring1.rotation.z += delta * 0.45 * speedMult
    this.ring1.rotation.x += delta * 0.25 * speedMult

    this.ring2.rotation.y += delta * 0.6 * speedMult
    this.ring2.rotation.z -= delta * 0.35 * speedMult

    this.ring3.rotation.x -= delta * 0.4 * speedMult
    this.ring3.rotation.y += delta * 0.3 * speedMult

    // Particle field slow drift
    this.particles.rotation.y += delta * 0.08

    // Audio/speech wave reactivity on core
    const isActuallySpeaking = this.isSpeaking || this.currentState === 'speaking' || this.currentState === 'responding'
    let targetScale = 1.0
    if (isActuallySpeaking) {
      targetScale = 1.0 + Math.sin(elapsed * 12.0) * 0.08 + Math.cos(elapsed * 7.5) * 0.04
    } else {
      targetScale = 1.0 + Math.sin(elapsed * 1.5) * 0.02
    }
    this.coreMesh.scale.setScalar(targetScale)
    this.wireframeMesh.scale.setScalar(targetScale * 1.06)

    // Subtle gentle core float
    this.proceduralGroup.position.y = Math.sin(elapsed * 1.2) * 0.04
  }

  private animateVrm(delta: number, elapsed: number): void {
    const vrm = this.currentVrm
    if (!vrm) return

    // 1. Idle breathing and micro-swaying on humanoid bones
    if (vrm.humanoid) {
      const chest = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest)
      const spine = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine)
      const head = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)

      const breath = Math.sin(elapsed * 1.8) * 0.012
      if (chest) chest.rotation.x = breath
      if (spine) spine.rotation.x = breath * 0.5

      // State-specific head tilt / emphasis
      let headRotX = Math.sin(elapsed * 0.8) * 0.015
      let headRotY = Math.cos(elapsed * 0.6) * 0.02
      let headRotZ = 0

      switch (this.currentState) {
        case 'listening':
          headRotZ = 0.05
          headRotX = -0.04
          break
        case 'thinking':
          headRotZ = -0.06
          headRotX = 0.06
          headRotY = 0.08
          break
        case 'waiting_confirmation':
          headRotZ = 0.08
          headRotX = 0.02
          break
        case 'speaking':
        case 'responding':
          // Subtle natural rhythmic head accent motions while speaking
          headRotX += Math.sin(elapsed * 4.0) * 0.02
          headRotY += Math.sin(elapsed * 2.5) * 0.015
          break
        case 'error':
          headRotX = 0.07
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
      this.nextBlinkInterval = 3.0 + Math.random() * 3.0 // Natural random interval
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

      if (vrm.expressionManager) {
        vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, blinkWeight)
      }
    }

    // 3. Speaking Mouth Movement Synchronization
    const isActuallySpeaking = this.isSpeaking || this.currentState === 'speaking' || this.currentState === 'responding'

    if (isActuallySpeaking) {
      // Modulate mouth opening with speech frequency rhythm
      const mouthTarget = (Math.sin(elapsed * 12) * 0.5 + 0.5) * 0.75 + (Math.sin(elapsed * 18) * 0.25 + 0.25) * 0.25
      this.speechMouthOpen = THREE.MathUtils.lerp(this.speechMouthOpen, mouthTarget, delta * 18)

      if (vrm.expressionManager) {
        // Blend primary open vowel 'aa' with secondary vowel 'oh'
        vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, this.speechMouthOpen * 0.8)
        vrm.expressionManager.setValue(VRMExpressionPresetName.Oh, this.speechMouthOpen * 0.2)
      }
    } else if (this.speechMouthOpen > 0.001) {
      // Smoothly close mouth to neutral when speaking stops
      this.speechMouthOpen = THREE.MathUtils.lerp(this.speechMouthOpen, 0, delta * 15)
      if (vrm.expressionManager) {
        vrm.expressionManager.setValue(VRMExpressionPresetName.Aa, this.speechMouthOpen)
        vrm.expressionManager.setValue(VRMExpressionPresetName.Oh, this.speechMouthOpen)
      }
    }

    // 4. State-Driven Facial Expressions
    if (vrm.expressionManager) {
      // Reset emotional presets smoothly
      const isHappy = this.currentState === 'idle'
      const isRelaxed = this.currentState === 'listening'
      const isSurprised = this.currentState === 'waiting_confirmation'
      const isSad = this.currentState === 'error'

      vrm.expressionManager.setValue(VRMExpressionPresetName.Happy, isHappy ? 0.25 : 0)
      vrm.expressionManager.setValue(VRMExpressionPresetName.Relaxed, isRelaxed ? 0.35 : 0)
      vrm.expressionManager.setValue(VRMExpressionPresetName.Surprised, isSurprised ? 0.4 : 0)
      vrm.expressionManager.setValue(VRMExpressionPresetName.Sad, isSad ? 0.5 : 0)
    }

    // 5. Update VRM internal spring bones and constraints
    vrm.update(delta)
  }

  // --- Teardown & Resource Disposal ---
  public dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange)

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

    // Dispose renderer
    if (this.renderer) {
      try {
        this.renderer.dispose()
        this.renderer.forceContextLoss()
      } catch {
        // Ignore context loss errors on teardown
      }
      this.renderer = null
    }
  }
}
