import React, { useState, useRef, useEffect, KeyboardEvent } from 'react'
import {
  Send,
  Mic,
  Sparkles,
  CornerDownLeft,
  Square,
  X,
  Volume2,
  VolumeX,
  Loader2,
  Square as StopIcon,
} from 'lucide-react'
import { useAura } from '../../context/AuraContext'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

export const ChatInput: React.FC = () => {
  const [input, setInput] = useState('')
  const {
    sendMessage,
    assistantState,
    setAssistantState,
    settings,
    updateSettings,
    isSpeaking,
    stopSpeech,
    systemStatus,
  } = useAura()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastTranscriptRef = useRef<{ text: string; timestamp: number } | null>(null)

  const {
    isRecording,
    isTranscribing,
    recordingDuration,
    maxDuration,
    audioLevels,
    permissionError,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  } = useVoiceRecorder()

  const isBusy =
    assistantState === 'thinking' ||
    assistantState === 'responding' ||
    assistantState === 'executing' ||
    assistantState === 'transcribing' ||
    isTranscribing

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`
    }
  }, [input])

  // Sync assistant state when recording or transcribing begins or ends
  useEffect(() => {
    if (isRecording) {
      setAssistantState('listening')
    } else if (isTranscribing) {
      setAssistantState('transcribing')
    } else if (
      (assistantState === 'listening' || assistantState === 'transcribing') &&
      !isRecording &&
      !isTranscribing
    ) {
      setAssistantState('idle')
    }
  }, [isRecording, isTranscribing, assistantState, setAssistantState])

  const handleSubmit = (): void => {
    if (!input.trim() || isBusy) return
    sendMessage(input.trim())
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'Escape' && isRecording) {
      e.preventDefault()
      handleCancel()
    }
  }

  const handleCancel = (): void => {
    cancelRecording()
    setAssistantState('cancelled')
    setTimeout(() => {
      setAssistantState('idle')
    }, 1000)
  }

  const handleMicClick = async (): Promise<void> => {
    if (isRecording) {
      const transcript = await stopAndTranscribe()
      if (transcript) {
        // Prevent sending duplicate copies of the same transcript within 3 seconds
        const now = Date.now()
        if (
          lastTranscriptRef.current &&
          lastTranscriptRef.current.text === transcript &&
          now - lastTranscriptRef.current.timestamp < 3000
        ) {
          console.warn('Duplicate voice transcript submission ignored.')
          return
        }
        lastTranscriptRef.current = { text: transcript, timestamp: now }
        sendMessage(transcript, true)
      }
    } else {
      if (isSpeaking) {
        stopSpeech()
      }
      await startRecording()
    }
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <footer
      style={{
        padding: '16px 20px',
        background: 'rgba(13, 16, 23, 0.85)',
        borderTop: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Permission Error Banner */}
      {permissionError && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#fca5a5',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span>{permissionError}</span>
          <button
            type="button"
            onClick={cancelRecording}
            aria-label="Dismiss error"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X style={{ width: '14px', height: '14px' }} />
          </button>
        </div>
      )}

      {/* Active Recording State Banner with Live Audio Waveform */}
      {isRecording && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#f87171',
            boxShadow: '0 0 12px rgba(239, 68, 68, 0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                background: '#ef4444',
                boxShadow: '0 0 8px #ef4444',
                display: 'inline-block',
                animation: 'pulse 1.2s infinite',
              }}
            />
            <span>
              <strong>Recording locally</strong> ({formatDuration(recordingDuration)} / {formatDuration(maxDuration)})
            </span>

            {/* Live Audio Frequency Waveform Visualizer */}
            <div
              aria-label="Audio Waveform"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                height: '22px',
                padding: '0 6px',
                marginLeft: '6px',
                background: 'rgba(0, 0, 0, 0.25)',
                borderRadius: '4px',
              }}
            >
              {audioLevels.map((lvl, idx) => {
                const heightPx = Math.max(3, Math.min(20, Math.round(lvl * 20)))
                return (
                  <span
                    key={idx}
                    style={{
                      width: '3px',
                      height: `${heightPx}px`,
                      borderRadius: '2px',
                      background: lvl > 0.4 ? '#ef4444' : lvl > 0.15 ? '#f87171' : 'rgba(248, 113, 113, 0.4)',
                      transition: 'height 60ms ease',
                      display: 'inline-block',
                    }}
                  />
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: 'var(--text-secondary)',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Cancel (Esc)
            </button>
            <button
              type="button"
              onClick={handleMicClick}
              style={{
                background: '#ef4444',
                border: 'none',
                color: '#fff',
                borderRadius: '6px',
                padding: '4px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Finish & Send
            </button>
          </div>
        </div>
      )}

      {/* Transcribing State Banner */}
      {isTranscribing && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: 'rgba(245, 166, 35, 0.12)',
            border: '1px solid rgba(245, 166, 35, 0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: '#f5a623',
          }}
        >
          <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />
          <span>Transcribing speech locally with faster-whisper...</span>
        </div>
      )}

      <div
        className="glass-panel"
        style={{
          borderRadius: '12px',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          border: isRecording ? '1px solid #ef4444' : '1px solid var(--border-subtle)',
          boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.25)' : '0 4px 20px rgba(0, 0, 0, 0.4)',
          transition: 'all 200ms ease',
        }}
      >
        {/* Push-to-Talk Microphone Button */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isBusy && !isRecording}
          aria-label={
            isRecording
              ? 'Stop Recording and Transcribe'
              : 'Microphone Voice Input (Push-to-Talk)'
          }
          title={
            isRecording
              ? 'Click to stop recording and send'
              : systemStatus.micReady
              ? 'Click to speak to AURA (Push-to-Talk)'
              : 'Local faster-whisper model ready. Click to speak.'
          }
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isRecording ? '#ffffff' : 'var(--accent-cyan)',
            background: isRecording
              ? '#ef4444'
              : 'rgba(0, 242, 254, 0.08)',
            border: isRecording
              ? '1px solid #ef4444'
              : '1px solid rgba(0, 242, 254, 0.3)',
            boxShadow: isRecording
              ? '0 0 12px rgba(239, 68, 68, 0.6)'
              : 'none',
            flexShrink: 0,
            cursor: isBusy && !isRecording ? 'not-allowed' : 'pointer',
            transition: 'all 200ms ease',
          }}
        >
          {isRecording ? (
            <Square style={{ width: '15px', height: '15px' }} />
          ) : (
            <Mic style={{ width: '18px', height: '18px' }} />
          )}
        </button>

        {/* Text Input Area */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
          rows={1}
          placeholder={
            isRecording
              ? 'Listening to speech...'
              : isTranscribing
              ? 'Transcribing audio locally...'
              : isBusy
              ? `AURA is ${assistantState}...`
              : `Instruct AURA with ${settings.modelName} (or click Mic to speak)...`
          }
          aria-label="Message AURA AI Assistant"
          style={{
            flex: 1,
            resize: 'none',
            fontSize: '13.5px',
            lineHeight: '1.5',
            color: 'var(--text-primary)',
            background: 'transparent',
            padding: '8px 4px',
            maxHeight: '140px',
          }}
        />

        {/* Send Action Button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!input.trim() || isBusy}
          aria-label="Send Message"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            background:
              input.trim() && !isBusy
                ? 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))'
                : 'rgba(255, 255, 255, 0.04)',
            color: input.trim() && !isBusy ? '#080a0f' : 'var(--text-muted)',
            boxShadow: input.trim() && !isBusy ? '0 0 12px var(--accent-cyan-glow)' : 'none',
            cursor: input.trim() && !isBusy ? 'pointer' : 'not-allowed',
            transition: 'all 200ms ease',
          }}
        >
          <Send style={{ width: '16px', height: '16px' }} />
        </button>
      </div>

      {/* Footer Hints, Voice Output & Interruption Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4px',
          fontSize: '11px',
          color: 'var(--text-muted)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles style={{ width: '11px', height: '11px', color: 'var(--accent-cyan)' }} />
            <span>
              Offline reasoning: <strong>{settings.modelName}</strong>
            </span>
          </div>

          {/* Voice Output Quick Control */}
          <button
            type="button"
            onClick={() => updateSettings({ voiceOutputEnabled: !settings.voiceOutputEnabled })}
            aria-label={settings.voiceOutputEnabled ? 'Mute Voice Output' : 'Enable Voice Output'}
            title={
              settings.voiceOutputEnabled
                ? 'Voice output enabled (click to mute)'
                : 'Voice output muted (click to enable)'
            }
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: settings.voiceOutputEnabled ? 'var(--accent-cyan)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 4px',
              borderRadius: '4px',
            }}
          >
            {settings.voiceOutputEnabled ? (
              <Volume2 style={{ width: '12px', height: '12px' }} />
            ) : (
              <VolumeX style={{ width: '12px', height: '12px' }} />
            )}
            <span>Voice {settings.voiceOutputEnabled ? 'On' : 'Muted'}</span>
          </button>

          {/* User Interruption: Stop Speaking Button */}
          {isSpeaking && (
            <button
              type="button"
              onClick={stopSpeech}
              aria-label="Stop Speaking Audio"
              style={{
                background: 'rgba(239, 68, 68, 0.18)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#f87171',
                cursor: 'pointer',
                borderRadius: '5px',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 0 8px rgba(239, 68, 68, 0.3)',
              }}
            >
              <StopIcon style={{ width: '10px', height: '10px', fill: 'currentColor' }} />
              <span>Stop Speaking</span>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>Press</span>
          <kbd
            style={{
              padding: '1px 5px',
              borderRadius: '4px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid var(--border-subtle)',
              fontSize: '10px',
              color: 'var(--text-secondary)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            Enter <CornerDownLeft style={{ width: '9px', height: '9px' }} />
          </kbd>
          <span>to send</span>
        </div>
      </div>
    </footer>
  )
}
