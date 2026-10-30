import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuraProvider } from '../src/renderer/src/context/AuraContext'
import { AvatarStage } from '../src/renderer/src/components/avatar/AvatarStage'
import { CharacterCanvas } from '../src/renderer/src/components/avatar/CharacterCanvas'
import * as THREE from 'three'

describe('AURA Phase 4: Animated Character & VRM Stage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the 3D procedural fallback avatar stage when no VRM model is configured', () => {
    render(
      <AuraProvider>
        <AvatarStage />
      </AuraProvider>
    )

    // Stage section with accessible label
    expect(screen.getByRole('region', { name: /animated character stage/i })).toBeInTheDocument()

    // Default Fallback mode indicators
    expect(screen.getByText(/procedural 3d avatar/i)).toBeInTheDocument()
    expect(screen.getByText(/holographic fallback/i)).toBeInTheDocument()

    // Ambient idle status
    expect(screen.getByText(/core stable • ambient monitoring/i)).toBeInTheDocument()
  })

  it('updates animation states and descriptive status text upon state change events', async () => {
    render(
      <AuraProvider>
        <AvatarStage />
      </AuraProvider>
    )

    // Initially idle
    expect(screen.getByText(/core stable • ambient monitoring/i)).toBeInTheDocument()

    // 1. Switch to Listening
    fireEvent.click(screen.getByRole('button', { name: /^listening$/i }))
    await waitFor(() => {
      expect(screen.getByText(/audio capture active • listening/i)).toBeInTheDocument()
    })

    // 2. Switch to Thinking
    fireEvent.click(screen.getByRole('button', { name: /^thinking$/i }))
    await waitFor(() => {
      expect(screen.getByText(/neural reasoning active/i)).toBeInTheDocument()
    })

    // 3. Switch to Speaking
    fireEvent.click(screen.getByRole('button', { name: /^speaking$/i }))
    await waitFor(() => {
      expect(screen.getByText(/speaking voice output & visemes active/i)).toBeInTheDocument()
    })

    // 4. Switch to Executing
    fireEvent.click(screen.getByRole('button', { name: /^executing$/i }))
    await waitFor(() => {
      expect(screen.getByText(/operating scoped tools & tasks/i)).toBeInTheDocument()
    })

    // 5. Switch to Waiting for Confirmation
    fireEvent.click(screen.getByRole('button', { name: /^confirmation$/i }))
    await waitFor(() => {
      expect(screen.getByText(/review gate engaged • approval required/i)).toBeInTheDocument()
    })

    // 6. Switch to Error state
    fireEvent.click(screen.getByRole('button', { name: /^error$/i }))
    await waitFor(() => {
      expect(screen.getByText(/anomaly intercepted • safe state/i)).toBeInTheDocument()
    })
  })

  it('calls native file dialog to select local VRM model when requested', async () => {
    const mockSelect = vi.mocked(window.auraAPI!.selectVrmFile!).mockResolvedValueOnce(null)

    render(
      <AuraProvider>
        <AvatarStage />
      </AuraProvider>
    )

    const loadVrmButton = screen.getByRole('button', { name: /load vrm/i })
    expect(loadVrmButton).toBeInTheDocument()

    fireEvent.click(loadVrmButton)

    await waitFor(() => {
      expect(mockSelect).toHaveBeenCalledTimes(1)
    })
  })

  it('handles missing or corrupt VRM model gracefully by showing error toast and reverting to fallback', async () => {
    render(
      <CharacterCanvas
        assistantState="idle"
        isSpeaking={false}
        vrmModelPath="C:\\Projects\\AURA\\models\\vrm\\corrupt_model.vrm"
      />
    )

    // Should display non-blocking error toast without crashing
    await waitFor(() => {
      expect(
        screen.getByText(/reverted to 3d procedural fallback/i)
      ).toBeInTheDocument()
    })
  })

  it('handles WebGL initialization failure gracefully by displaying a safe fallback UI', () => {
    const spy = vi.spyOn(THREE, 'WebGLRenderer').mockImplementationOnce(() => {
      throw new Error('Hardware acceleration disabled by policy')
    })

    try {
      render(
        <CharacterCanvas
          assistantState="idle"
          isSpeaking={false}
          vrmModelPath=""
        />
      )

      expect(screen.getByText(/webgl acceleration unavailable/i)).toBeInTheDocument()
      expect(screen.getByText(/hardware acceleration disabled by policy/i)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('cleans up Three.js controllers and event observers cleanly on unmount', () => {
    const { unmount } = render(
      <AuraProvider>
        <AvatarStage />
      </AuraProvider>
    )

    // Unmounting should trigger dispose() and disconnect ResizeObserver without exceptions
    expect(() => unmount()).not.toThrow()
  })
})
