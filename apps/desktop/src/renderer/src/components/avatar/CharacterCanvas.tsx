import React, { useEffect, useRef, useState, useCallback } from 'react'
import { CharacterController, GraphicsErrorCategory } from './CharacterController'
import { AssistantState, CharacterTelemetry } from '../../types'
import { useAura } from '../../context/AuraContext'
import { AlertCircle, Loader2 } from 'lucide-react'

interface CharacterCanvasProps {
  assistantState: AssistantState
  isSpeaking: boolean
  vrmModelPath?: string
  speechAnalyser?: AnalyserNode | null
  onTelemetry?: (telemetry: Partial<CharacterTelemetry>) => void
}

export const CharacterCanvas: React.FC<CharacterCanvasProps> = ({
  assistantState,
  isSpeaking,
  vrmModelPath,
  speechAnalyser,
  onTelemetry
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const controllerRef = useRef<CharacterController | null>(null)

  let auraAnalyser: AnalyserNode | null = null
  try {
    const aura = useAura()
    auraAnalyser = aura.speechAnalyser
  } catch {
    // Rendered outside AuraProvider (e.g. isolated test environments)
  }
  const activeAnalyser = speechAnalyser !== undefined ? speechAnalyser : auraAnalyser

  const [webglError, setWebglError] = useState<{ message: string; category?: GraphicsErrorCategory } | null>(null)
  const [retryCount, setRetryCount] = useState<number>(0)
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const handleTelemetry = useCallback(
    (telemetry: Partial<CharacterTelemetry>) => {
      if (onTelemetry) {
        onTelemetry(telemetry)
      }
    },
    [onTelemetry]
  )

  // Initialize CharacterController & WebGL Scene
  useEffect(() => {
    if (!canvasRef.current) return

    try {
      const controller = new CharacterController(canvasRef.current, {
        onTelemetry: handleTelemetry,
        onError: (err, category) => {
          if (
            err.includes('WebGL initialization failed') ||
            category === 'gpu_unavailable' ||
            category === 'webgl2_unsupported' ||
            category === 'renderer_init_failed' ||
            category === 'context_lost'
          ) {
            setWebglError({ message: err, category })
          } else {
            setModelError(err)
          }
        }
      })
      controllerRef.current = controller

      // Setup ResizeObserver for dynamic window/container sizing
      const container = containerRef.current
      if (container) {
        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height } = entry.contentRect
            if (width > 0 && height > 0) {
              controller.resize(width, height)
            }
          }
        })
        resizeObserver.observe(container)

        // Initial sizing
        const rect = container.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          controller.resize(rect.width, rect.height)
        }

        return () => {
          resizeObserver.disconnect()
          controller.dispose()
          controllerRef.current = null
        }
      }

      return () => {
        controller.dispose()
        controllerRef.current = null
      }
    } catch (err) {
      const errMsg = `WebGL is not supported or failed to initialize: ${err instanceof Error ? err.message : String(err)}`
      setWebglError({ message: errMsg, category: 'unknown_exception' })
      return undefined
    }
  }, [handleTelemetry, retryCount])

  // Sync Assistant State
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setState(assistantState)
    }
  }, [assistantState])

  // Sync Speaking State
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setSpeaking(isSpeaking)
    }
  }, [isSpeaking])

  // Sync Web Audio Analyser for Lip-Sync Visemes
  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.setAudioAnalyser(activeAnalyser || null)
    }
  }, [activeAnalyser])

  // Handle VRM Model Path Changes
  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return

    if (!vrmModelPath || !vrmModelPath.trim()) {
      controller.resetToProceduralFallback()
      setModelError(null)
      setIsLoadingModel(false)
      return
    }

    const cleanPath = vrmModelPath.trim()
    setIsLoadingModel(true)
    setModelError(null)

    let isMounted = true

    async function loadVrm(): Promise<void> {
      try {
        let buffer: ArrayBuffer

        // Priority 1: Electron safe native binary reader via preload
        if (typeof window !== 'undefined' && window.auraAPI?.loadVrmBinary) {
          buffer = await window.auraAPI.loadVrmBinary(cleanPath)
        } else {
          // Priority 2: Fetch local file URL or relative asset
          // Strictly avoid external web downloads
          if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
            const parsed = new URL(cleanPath)
            if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
              throw new Error('Remote avatar downloads are forbidden for privacy. Use local models only.')
            }
          }

          const response = await fetch(cleanPath)
          if (!response.ok) {
            throw new Error(`Failed to load VRM file: HTTP ${response.status}`)
          }
          buffer = await response.arrayBuffer()
        }

        if (!isMounted || !controllerRef.current) return

        const fileName = cleanPath.split(/[/\\]/).pop() || 'Custom VRM'
        await controllerRef.current.loadModelFromBuffer(buffer, fileName)

        if (isMounted) {
          setIsLoadingModel(false)
          setModelError(null)
        }
      } catch (err) {
        if (!isMounted) return
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[CharacterCanvas] Could not load VRM model:', msg)
        setModelError(msg)
        setIsLoadingModel(false)
        if (controllerRef.current) {
          controllerRef.current.resetToProceduralFallback()
        }
      }
    }

    loadVrm()

    return () => {
      isMounted = false
    }
  }, [vrmModelPath])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '260px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden'
      }}
    >
      {/* Three.js Hardware Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: webglError ? 'none' : 'block',
          outline: 'none'
        }}
        tabIndex={-1}
      />

      {/* Model Parsing Overlay */}
      {isLoadingModel && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(8, 10, 15, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            zIndex: 10
          }}
        >
          <Loader2 className="animate-spin" style={{ width: '32px', height: '32px', color: '#00f2fe' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Parsing VRM Model & Humanoid Bones...
          </span>
        </div>
      )}

      {/* Non-blocking Model Error Toast */}
      {modelError && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            maxWidth: '90%',
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(229, 49, 112, 0.15)',
            border: '1px solid rgba(229, 49, 112, 0.4)',
            color: '#ff8ba7',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backdropFilter: 'blur(8px)',
            zIndex: 12
          }}
        >
          <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0 }} />
          <span>{modelError}. Reverted to 3D procedural fallback.</span>
        </div>
      )}

      {/* WebGL Hardware Failure Fallback */}
      {webglError && (
        <div
          style={{
            padding: '24px',
            textAlign: 'center',
            maxWidth: '420px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '12px',
            border: '1px solid rgba(229, 49, 112, 0.3)',
            backdropFilter: 'blur(8px)',
            zIndex: 15
          }}
        >
          <AlertCircle style={{ width: '36px', height: '36px', color: '#e53170', margin: '0 auto 12px' }} />
          <h4 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
            WebGL Acceleration Unavailable
          </h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '14px' }}>
            {webglError.message}
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button
              onClick={() => {
                setWebglError(null)
                setRetryCount((c) => c + 1)
              }}
              style={{
                background: 'rgba(0, 242, 254, 0.15)',
                border: '1px solid rgba(0, 242, 254, 0.4)',
                color: '#00f2fe',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Retry WebGL
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
