import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../src/renderer/src/App'

describe('AURA Phase 3 Voice Interaction', () => {
  it('renders Push-to-Talk microphone button with proper accessibility label', () => {
    render(<App />)

    const micButton = screen.getByLabelText(/Microphone Voice Input/i)
    expect(micButton).toBeInTheDocument()
  })

  it('allows user to toggle Voice Output mute control in chat footer', () => {
    render(<App />)

    const voiceToggle = screen.getByLabelText(/Mute Voice Output|Enable Voice Output/i)
    expect(voiceToggle).toBeInTheDocument()

    // Initially Voice On
    expect(screen.getByText('Voice On')).toBeInTheDocument()

    // Click to toggle to Voice Muted
    fireEvent.click(voiceToggle)
    expect(screen.getByText('Voice Muted')).toBeInTheDocument()

    // Click again to re-enable
    fireEvent.click(voiceToggle)
    expect(screen.getByText('Voice On')).toBeInTheDocument()
  })

  it('starts local recording on Push-to-Talk button click and shows recording banner', async () => {
    render(<App />)

    const micButton = screen.getByLabelText(/Microphone Voice Input/i)
    fireEvent.click(micButton)

    await waitFor(() => {
      expect(screen.getByText(/Recording locally/i)).toBeInTheDocument()
    })

    // Cancel recording
    const cancelButton = screen.getByText(/Cancel \(Esc\)/i)
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(screen.queryByText(/Recording locally/i)).not.toBeInTheDocument()
    })
  })

  it('completes Push-to-Talk recording, transcribes audio, and displays transcript', async () => {
    render(<App />)

    const micButton = screen.getByLabelText(/Microphone Voice Input/i)
    fireEvent.click(micButton)

    await waitFor(() => {
      expect(screen.getByText(/Recording locally/i)).toBeInTheDocument()
    })

    // Click "Finish & Send"
    const finishButton = screen.getByText('Finish & Send')
    fireEvent.click(finishButton)

    // The mocked transcribeAudio returns "Hello AURA this is a spoken prompt."
    await waitFor(() => {
      expect(screen.getByText('Hello AURA this is a spoken prompt.')).toBeInTheDocument()
      expect(screen.getByText('Voice Input')).toBeInTheDocument()
    })
  })

  it('displays user-friendly error banner if microphone permission is rejected', async () => {
    // Temporarily mock getUserMedia rejection
    const mockGetUserMedia = vi.fn().mockRejectedValue({
      name: 'NotAllowedError',
      message: 'Permission denied',
    })
    navigator.mediaDevices.getUserMedia = mockGetUserMedia as unknown as typeof navigator.mediaDevices.getUserMedia

    render(<App />)

    const micButton = screen.getByLabelText(/Microphone Voice Input/i)
    fireEvent.click(micButton)

    await waitFor(() => {
      expect(
        screen.getByText(/Microphone permission was denied/i)
      ).toBeInTheDocument()
    })
  })
})
