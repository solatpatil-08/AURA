import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../src/renderer/src/App'

describe('AURA Desktop Application Foundation', () => {
  it('renders application shell and local-first security badges', () => {
    render(<App />)

    // Check title bar branding
    const auraBrandElements = screen.getAllByText('AURA')
    expect(auraBrandElements.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Local-First Sandbox')).toBeInTheDocument()
    expect(screen.getByText('Desktop v0.1.0')).toBeInTheDocument()
  })

  it('renders the initial assistant conversation message', () => {
    render(<App />)

    // Verify initial greeting content
    expect(screen.getByText(/Greetings\. I am/i)).toBeInTheDocument()
  })

  it('renders system status indicators including voice readiness in the footer', () => {
    render(<App />)

    expect(screen.getByText('Ollama:')).toBeInTheDocument()
    const modelTags = screen.getAllByText('qwen3.5:4b')
    expect(modelTags.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/STT/)).toBeInTheDocument()
    expect(screen.getByText(/TTS/)).toBeInTheDocument()
  })

  it('allows navigation to Settings screen with voice options', () => {
    render(<App />)

    const settingsButton = screen.getByLabelText('Settings')
    fireEvent.click(settingsButton)

    expect(
      screen.getByText('System Settings & Security Configuration')
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/Configurable Local Model Name/i)
    ).toHaveValue('qwen3.5:4b')
    expect(
      screen.getByLabelText(/Spoken Assistant Responses/i)
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText(/Speech Playback Volume/i)
    ).toBeInTheDocument()
  })

  it('allows user to send a prompt and updates the message feed', () => {
    render(<App />)

    // Switch back to chat if on settings
    const chatButton = screen.getByLabelText('Conversation')
    fireEvent.click(chatButton)

    const inputArea = screen.getByLabelText('Message AURA AI Assistant')
    fireEvent.change(inputArea, { target: { value: 'Test prompt from user' } })

    const sendButton = screen.getByLabelText('Send Message')
    fireEvent.click(sendButton)

    // User message should appear
    expect(screen.getByText('Test prompt from user')).toBeInTheDocument()
  })
})
