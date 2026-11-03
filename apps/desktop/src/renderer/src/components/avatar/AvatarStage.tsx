import React, { useState } from 'react'
import { useAura } from '../../context/AuraContext'
import { CharacterCanvas } from './CharacterCanvas'
import { AssistantState, CharacterTelemetry } from '../../types'
import {
  Sparkles,
  Radio,
  Cpu,
  Volume2,
  ShieldAlert,
  AlertTriangle,
  Layers,
  FolderOpen,
  RotateCcw,
  Activity,
  Bot
} from 'lucide-react'

export const AvatarStage: React.FC = () => {
  const { assistantState, setAssistantState, isSpeaking, settings, updateSettings } = useAura()
  const [telemetry, setTelemetry] = useState<Partial<CharacterTelemetry>>({
    mode: 'procedural',
    modelName: 'Holographic Fallback Core',
    fps: 60
  })

  const stateDetails: Record<
    AssistantState,
    {
      color: string
      bgGlow: string
      icon: React.ComponentType<{ style?: React.CSSProperties }>
      label: string
      statusText: string
    }
  > = {
    idle: {
      color: '#00f2fe',
      bgGlow: 'radial-gradient(circle, rgba(0, 242, 254, 0.18) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Sparkles,
      label: 'Idle',
      statusText: 'Core Stable • Ambient Monitoring'
    },
    listening: {
      color: '#2cb67d',
      bgGlow: 'radial-gradient(circle, rgba(44, 182, 125, 0.22) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Radio,
      label: 'Listening',
      statusText: 'Audio Capture Active • Listening'
    },
    transcribing: {
      color: '#f5a623',
      bgGlow: 'radial-gradient(circle, rgba(245, 166, 35, 0.22) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Activity,
      label: 'Transcribing',
      statusText: 'Local faster-whisper Speech Recognition Active'
    },
    thinking: {
      color: '#7f5af0',
      bgGlow: 'radial-gradient(circle, rgba(127, 90, 240, 0.25) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Cpu,
      label: 'Thinking',
      statusText: `Neural Reasoning Active • ${settings.modelName}`
    },
    responding: {
      color: '#4facfe',
      bgGlow: 'radial-gradient(circle, rgba(79, 172, 254, 0.22) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Volume2,
      label: 'Responding',
      statusText: 'Synthesizing Local Speech & Visemes'
    },
    speaking: {
      color: '#4facfe',
      bgGlow: 'radial-gradient(circle, rgba(79, 172, 254, 0.22) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Volume2,
      label: 'Speaking',
      statusText: 'Speaking Voice Output & Visemes Active'
    },
    executing: {
      color: '#ff8906',
      bgGlow: 'radial-gradient(circle, rgba(255, 137, 6, 0.22) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Layers,
      label: 'Executing',
      statusText: 'Operating Scoped Tools & Tasks'
    },
    waiting_confirmation: {
      color: '#ffd166',
      bgGlow: 'radial-gradient(circle, rgba(255, 209, 102, 0.25) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: ShieldAlert,
      label: 'Confirmation',
      statusText: 'Review Gate Engaged • Approval Required'
    },
    cancelled: {
      color: '#a0aec0',
      bgGlow: 'radial-gradient(circle, rgba(160, 174, 192, 0.2) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: Sparkles,
      label: 'Cancelled',
      statusText: 'Voice Input Cancelled • Standby'
    },
    error: {
      color: '#e53170',
      bgGlow: 'radial-gradient(circle, rgba(229, 49, 112, 0.25) 0%, rgba(8, 10, 15, 0) 70%)',
      icon: AlertTriangle,
      label: 'Error',
      statusText: 'Anomaly Intercepted • Safe State'
    }
  }

  const currentVisual = stateDetails[assistantState] || stateDetails.idle
  const StatusIcon = currentVisual.icon

  // Select local VRM file using native Electron dialog and store in userData
  const handleSelectVrm = async (): Promise<void> => {
    if (typeof window !== 'undefined' && window.auraAPI?.selectVrmFile) {
      try {
        const filePath = await window.auraAPI.selectVrmFile()
        if (filePath) {
          let finalPath = filePath
          if (window.auraAPI.saveVrmCharacter) {
            try {
              finalPath = await window.auraAPI.saveVrmCharacter(filePath)
            } catch (saveErr) {
              console.warn('Failed to copy VRM to local user data folder:', saveErr)
            }
          }
          updateSettings({ vrmModelPath: finalPath })
        }
      } catch (err) {
        console.error('Failed to open VRM file dialog:', err)
      }
    }
  }

  const handleResetFallback = async (): Promise<void> => {
    if (typeof window !== 'undefined' && window.auraAPI?.resetVrmCharacter) {
      try {
        await window.auraAPI.resetVrmCharacter()
      } catch (err) {
        console.warn('Failed to reset stored VRM character:', err)
      }
    }
    updateSettings({ vrmModelPath: '' })
  }

  const testStates: AssistantState[] = [
    'idle',
    'listening',
    'thinking',
    'speaking',
    'executing',
    'waiting_confirmation',
    'error'
  ]

  return (
    <section
      aria-label="Animated Character Stage"
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        background: '#07090e'
      }}
    >
      {/* Background radial glow reacting to assistant state */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '650px',
          height: '650px',
          background: currentVisual.bgGlow,
          transition: 'background 600ms ease',
          pointerEvents: 'none',
          zIndex: 0
        }}
      />

      {/* Top Telemetry & Control Bar */}
      <header
        style={{
          position: 'relative',
          zIndex: 5,
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          background: 'rgba(7, 9, 14, 0.65)',
          backdropFilter: 'blur(10px)'
        }}
      >
        {/* Model Info Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${currentVisual.color}40`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Bot style={{ width: '18px', height: '18px', color: currentVisual.color }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {telemetry.mode === 'vrm' ? telemetry.modelName : 'Procedural 3D Avatar'}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: telemetry.mode === 'vrm' ? 'rgba(44, 182, 125, 0.2)' : 'rgba(0, 242, 254, 0.15)',
                  color: telemetry.mode === 'vrm' ? '#2cb67d' : '#00f2fe',
                  border: `1px solid ${telemetry.mode === 'vrm' ? 'rgba(44, 182, 125, 0.4)' : 'rgba(0, 242, 254, 0.3)'}`
                }}
              >
                {telemetry.mode === 'vrm' ? 'VRM Character' : 'Holographic Fallback'}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {telemetry.mode === 'vrm' && telemetry.vrmMeta?.author
                ? `Author: ${telemetry.vrmMeta.author} • ${telemetry.gpuRenderer || 'Hardware WebGL'}`
                : `${telemetry.gpuRenderer || 'Hardware WebGL'} • Three.js v0.186 & @pixiv/three-vrm v3.5`}
            </div>
          </div>
        </div>

        {/* Telemetry Stats & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Active GPU Renderer Badge (Phase 8) */}
          {telemetry.gpuRenderer && telemetry.gpuRenderer !== 'Detecting...' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: telemetry.gpuRenderer.toLowerCase().includes('nvidia')
                  ? 'rgba(118, 185, 0, 0.15)'
                  : 'rgba(255, 255, 255, 0.04)',
                border: telemetry.gpuRenderer.toLowerCase().includes('nvidia')
                  ? '1px solid rgba(118, 185, 0, 0.4)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                color: telemetry.gpuRenderer.toLowerCase().includes('nvidia')
                  ? '#76b900'
                  : 'var(--text-muted)',
                fontSize: '11px',
                fontFamily: 'monospace'
              }}
              title={telemetry.gpuRenderer}
            >
              <span>{telemetry.gpuRenderer.toLowerCase().includes('nvidia') ? 'NVIDIA RTX' : 'Active GPU'}</span>
            </div>
          )}

          {/* Context Loss Counter (Phase 8) */}
          {typeof telemetry.contextLostCount === 'number' && telemetry.contextLostCount > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: 'rgba(245, 166, 35, 0.15)',
                border: '1px solid rgba(245, 166, 35, 0.35)',
                color: '#f5a623',
                fontSize: '11px'
              }}
              title="GPU reset events intercepted and restored"
            >
              <span>GPU Resets: {telemetry.contextLostCount}</span>
            </div>
          )}
          {/* Expressions Count Pill for VRM */}
          {telemetry.mode === 'vrm' && typeof telemetry.expressionsCount === 'number' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'var(--text-muted)',
                fontSize: '11px',
                fontFamily: 'monospace'
              }}
              title="Verified expression morph targets on loaded VRM character"
            >
              <span>{telemetry.expressionsCount} Expressions</span>
            </div>
          )}

          {/* Audio Viseme Sync Pill */}
          {isSpeaking && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '6px',
                background: 'rgba(79, 172, 254, 0.15)',
                border: '1px solid rgba(79, 172, 254, 0.35)',
                color: '#4facfe',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              <Volume2 className="animate-pulse" style={{ width: '13px', height: '13px' }} />
              <span>
                {telemetry.audioAmplitude !== undefined && telemetry.audioAmplitude > 0
                  ? `Lip-Sync (${Math.round(telemetry.audioAmplitude * 100)}%)`
                  : 'Speech Synced'}
              </span>
            </div>
          )}

          {/* FPS Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 8px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'var(--text-muted)',
              fontSize: '11px',
              fontFamily: 'monospace'
            }}
          >
            <Activity style={{ width: '12px', height: '12px', color: '#00f2fe' }} />
            <span>{typeof telemetry.fps === 'number' ? telemetry.fps : 0} FPS</span>
          </div>

          {/* Load / Reset VRM Model Buttons */}
          <button
            onClick={handleSelectVrm}
            title="Load local .vrm model file from your workstation"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 200ms ease'
            }}
          >
            <FolderOpen style={{ width: '13px', height: '13px', color: '#00f2fe' }} />
            <span>{settings.vrmModelPath ? 'Change VRM' : 'Load VRM'}</span>
          </button>

          {settings.vrmModelPath && (
            <button
              onClick={handleResetFallback}
              title="Reset to 3D procedural holographic core fallback"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <RotateCcw style={{ width: '12px', height: '12px' }} />
              <span>Use Fallback</span>
            </button>
          )}
        </div>
      </header>

      {/* Primary 3D Character Viewport */}
      <main
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1
        }}
      >
        <CharacterCanvas
          assistantState={assistantState}
          isSpeaking={isSpeaking}
          vrmModelPath={settings.vrmModelPath}
          onTelemetry={setTelemetry}
        />
      </main>

      {/* Bottom Telemetry & State Control Bar */}
      <footer
        style={{
          position: 'relative',
          zIndex: 5,
          padding: '16px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(7, 9, 14, 0.75)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)'
        }}
      >
        {/* Active State Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            borderRadius: '9999px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${currentVisual.color}40`,
            boxShadow: `0 0 16px ${currentVisual.color}20`
          }}
        >
          <StatusIcon style={{ width: '14px', height: '14px', color: currentVisual.color }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {currentVisual.statusText}
          </span>
        </div>

        {/* State Simulation Bar for Interactive Testing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '4px' }}>
            Test State:
          </span>
          {testStates.map((st) => {
            const isActive = assistantState === st
            const info = stateDetails[st]
            return (
              <button
                key={st}
                onClick={() => setAssistantState(st)}
                style={{
                  fontSize: '11px',
                  fontWeight: isActive ? 600 : 400,
                  padding: '4px 10px',
                  borderRadius: '6px',
                  background: isActive ? `${info.color}20` : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${isActive ? info.color : 'rgba(255, 255, 255, 0.08)'}`,
                  color: isActive ? info.color : 'var(--text-muted)',
                  cursor: 'pointer',
                  transition: 'all 150ms ease'
                }}
              >
                {info.label}
              </button>
            )
          })}
        </div>
      </footer>
    </section>
  )
}
