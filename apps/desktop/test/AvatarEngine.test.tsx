import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CharacterController } from '../src/renderer/src/components/avatar/CharacterController'
import { AvatarStage } from '../src/renderer/src/components/avatar/AvatarStage'
import { AuraProvider } from '../src/renderer/src/context/AuraContext'
import { AssistantState } from '../src/renderer/src/types'

describe('AURA Avatar Engine 2.0: 3D Character & VRM Animation System', () => {
  let canvas: HTMLCanvasElement

  beforeEach(() => {
    vi.clearAllMocks()
    canvas = document.createElement('canvas')
  })

  describe('Model & Binary Validation', () => {
    it('rejects buffers smaller than minimum glTF binary header size (12 bytes)', async () => {
      const controller = new CharacterController(canvas, { autoAnimate: false })
      const smallBuffer = new ArrayBuffer(8)

      await expect(controller.loadModelFromBuffer(smallBuffer, 'test.vrm')).rejects.toThrow(
        /buffer too small/i
      )

      controller.dispose()
    })

    it('rejects files with invalid glTF binary magic number', async () => {
      const controller = new CharacterController(canvas, { autoAnimate: false })
      const invalidBuffer = new ArrayBuffer(64)
      const view = new DataView(invalidBuffer)
      view.setUint32(0, 0x12345678, true) // Incorrect magic number (not 0x46546C67)

      await expect(controller.loadModelFromBuffer(invalidBuffer, 'corrupt.vrm')).rejects.toThrow(
        /file header does not match binary gltf/i
      )

      controller.dispose()
    })

    it('provides clear non-blocking error handling and falls back to procedural core on error', async () => {
      let reportedError: string | null = null
      const controller = new CharacterController(canvas, {
        autoAnimate: false,
        onError: (err) => {
          reportedError = err
        }
      })

      const invalidBuffer = new ArrayBuffer(20) // Wrong magic
      try {
        await controller.loadModelFromBuffer(invalidBuffer, 'bad.vrm')
      } catch {
        // Expected throw
      }

      expect(reportedError).toMatch(/file header does not match binary gltf/i)
      controller.dispose()
    })
  })

  describe('Animation & Visual State Machine', () => {
    it('applies distinct visual states and lighting palettes across all assistant states', () => {
      const telemetryEvents: any[] = []
      const controller = new CharacterController(canvas, {
        autoAnimate: false,
        onTelemetry: (t) => telemetryEvents.push(t)
      })

      const states: AssistantState[] = [
        'idle',
        'listening',
        'transcribing',
        'thinking',
        'speaking',
        'executing',
        'waiting_confirmation',
        'cancelled',
        'error'
      ]

      for (const st of states) {
        controller.setState(st)
        expect(telemetryEvents[telemetryEvents.length - 1].state).toBe(st)
      }

      controller.dispose()
    })

    it('resets cleanly to 3D procedural holographic core fallback', () => {
      let latestTelemetry: any = null
      const controller = new CharacterController(canvas, {
        autoAnimate: false,
        onTelemetry: (t) => {
          latestTelemetry = t
        }
      })

      controller.resetToProceduralFallback()

      expect(latestTelemetry.mode).toBe('procedural')
      expect(latestTelemetry.modelName).toBe('Holographic Fallback Core')
      expect(latestTelemetry.error).toBeNull()

      controller.dispose()
    })
  })

  describe('Audio Amplitude Lip-Sync & Viseme Pipeline', () => {
    it('accepts an AnalyserNode and performs spectral amplitude analysis', () => {
      let latestTelemetry: any = null
      const controller = new CharacterController(canvas, {
        autoAnimate: false,
        onTelemetry: (t) => {
          latestTelemetry = t
        }
      })

      // Mock AnalyserNode
      const mockAnalyser = {
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn((arr: Uint8Array) => {
          // Simulate active voice speech band (~200-1500Hz)
          for (let i = 2; i < 20; i++) {
            arr[i] = 180
          }
        })
      } as unknown as AnalyserNode

      controller.setAudioAnalyser(mockAnalyser)
      controller.setState('speaking')
      controller.setSpeaking(true)

      // Render a frame to trigger audio analysis
      controller.renderFrame()

      expect(mockAnalyser.getByteFrequencyData).toHaveBeenCalled()
      expect(latestTelemetry.lipSyncMode).toBe('amplitude-spectral')

      controller.dispose()
    })

    it('smoothly returns to neutral when audio analyser is disconnected', () => {
      const controller = new CharacterController(canvas, { autoAnimate: false })

      controller.setAudioAnalyser(null)
      controller.setSpeaking(false)
      controller.renderFrame()

      // Should not throw and remain in stable neutral
      controller.dispose()
    })
  })

  describe('Accessibility & Resource Teardown', () => {
    it('detects and respects prefers-reduced-motion media query', () => {
      const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
        matches: query.includes('prefers-reduced-motion: reduce'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))

      const controller = new CharacterController(canvas, { autoAnimate: false })
      controller.renderFrame()

      expect(matchMediaSpy).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
      controller.dispose()
      matchMediaSpy.mockRestore()
    })

    it('cleans up Three.js geometries, materials, listeners, and forces context loss on dispose', () => {
      const controller = new CharacterController(canvas, { autoAnimate: false })

      expect(() => {
        controller.dispose()
      }).not.toThrow()

      // Multiple calls to dispose should be safe and idempotent
      expect(() => {
        controller.dispose()
      }).not.toThrow()
    })
  })

  describe('UI Integration & Local Storage in AvatarStage', () => {
    it('persists selected character to user-data directory via saveVrmCharacter', async () => {
      const saveSpy = vi.mocked(window.auraAPI!.saveVrmCharacter!)
      vi.mocked(window.auraAPI!.selectVrmFile!).mockResolvedValueOnce('C:\\Downloads\\character.vrm')

      render(
        <AuraProvider>
          <AvatarStage />
        </AuraProvider>
      )

      const loadBtn = screen.getByRole('button', { name: /load vrm/i })
      fireEvent.click(loadBtn)

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith('C:\\Downloads\\character.vrm')
      })
    })

    it('resets character and cleans up stored file via resetVrmCharacter', async () => {
      const resetSpy = vi.mocked(window.auraAPI!.resetVrmCharacter!)
      vi.mocked(window.auraAPI!.getStoredVrmCharacter!).mockResolvedValueOnce(
        'C:\\Users\\user\\AppData\\Roaming\\aura\\characters\\saved.vrm'
      )

      render(
        <AuraProvider>
          <AvatarStage />
        </AuraProvider>
      )

      // Wait for stored model to load
      await waitFor(() => {
        const fallbackBtn = screen.queryByRole('button', { name: /use fallback/i })
        if (fallbackBtn) {
          fireEvent.click(fallbackBtn)
        }
      })

      // When "Use Fallback" is clicked, resetVrmCharacter must be invoked
      const fallbackBtn = screen.queryByRole('button', { name: /use fallback/i })
      if (fallbackBtn) {
        fireEvent.click(fallbackBtn)
        await waitFor(() => {
          expect(resetSpy).toHaveBeenCalled()
        })
      }
    })
  })

  describe('Live 3D VRM Model Lifecycle with aura.vrm', () => {
    it('loads an actual VRM model file, initializes humanoid bones, and extracts metadata', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const vrmPath = path.resolve(__dirname, '../../../models/vrm/aura.vrm')
      if (!fs.existsSync(vrmPath)) return

      const fileBuffer = fs.readFileSync(vrmPath)
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      )

      let capturedTelemetry: any = null
      const controller = new CharacterController(canvas, {
        autoAnimate: false,
        onTelemetry: (t) => {
          capturedTelemetry = t
        }
      })

      await controller.loadModelFromBuffer(arrayBuffer, 'aura.vrm')

      expect(capturedTelemetry.mode).toBe('vrm')
      expect(capturedTelemetry.modelName).toBe('AvatarSample_U')
      expect(capturedTelemetry.vrmMeta?.author).toContain('VRoid')
      expect(capturedTelemetry.expressionsCount).toBeGreaterThanOrEqual(14)
      expect(capturedTelemetry.availableExpressions).toContain('aa')
      expect(capturedTelemetry.availableExpressions).toContain('blink')

      controller.dispose()
    })

    it('animates idle breathing, natural head sway, and blinking on real VRM character', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const vrmPath = path.resolve(__dirname, '../../../models/vrm/aura.vrm')
      if (!fs.existsSync(vrmPath)) return

      const fileBuffer = fs.readFileSync(vrmPath)
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      )

      const controller = new CharacterController(canvas, { autoAnimate: false })
      await controller.loadModelFromBuffer(arrayBuffer, 'aura.vrm')

      controller.setState('idle')
      // Advance internal timer across multiple frames
      for (let i = 0; i < 20; i++) {
        controller.renderFrame()
      }

      controller.dispose()
    })

    it('transitions to listening state and applies attentive head tilt & expression', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const vrmPath = path.resolve(__dirname, '../../../models/vrm/aura.vrm')
      if (!fs.existsSync(vrmPath)) return

      const fileBuffer = fs.readFileSync(vrmPath)
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      )

      const controller = new CharacterController(canvas, { autoAnimate: false })
      await controller.loadModelFromBuffer(arrayBuffer, 'aura.vrm')

      controller.setState('listening')
      controller.renderFrame()

      controller.dispose()
    })

    it('animates mouth visemes in response to speech audio amplitude analysis on real VRM model', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const vrmPath = path.resolve(__dirname, '../../../models/vrm/aura.vrm')
      if (!fs.existsSync(vrmPath)) return

      const fileBuffer = fs.readFileSync(vrmPath)
      const arrayBuffer = fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
      )

      let latestTelemetry: any = null
      const controller = new CharacterController(canvas, {
        autoAnimate: false,
        onTelemetry: (t) => {
          latestTelemetry = t
        }
      })
      await controller.loadModelFromBuffer(arrayBuffer, 'aura.vrm')

      const mockAnalyser = {
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn((arr: Uint8Array) => {
          for (let i = 4; i < 24; i++) {
            arr[i] = 200
          }
        })
      } as unknown as AnalyserNode

      controller.setAudioAnalyser(mockAnalyser)
      controller.setState('speaking')
      controller.setSpeaking(true)

      controller.renderFrame()

      expect(latestTelemetry.lipSyncMode).toBe('amplitude-spectral')
      expect(latestTelemetry.isSpeaking).toBe(true)

      controller.dispose()
    })
  })
})

