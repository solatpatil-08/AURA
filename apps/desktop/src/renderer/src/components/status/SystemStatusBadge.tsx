import React from 'react'
import { useAura } from '../../context/AuraContext'
import {
  Server,
  Cpu,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Bot,
  Layers,
  Activity,
  CheckCircle2
} from 'lucide-react'

function formatGpuName(raw?: string): string {
  if (!raw) return 'Detecting...'
  const upper = raw.toUpperCase()
  if (upper.includes('3050')) return 'RTX 3050'
  if (upper.includes('NVIDIA') || upper.includes('GEFORCE')) return 'NVIDIA GPU'
  if (upper.includes('INTEL') || upper.includes('UHD') || upper.includes('IRIS')) return 'Intel UHD'
  if (upper.includes('APPLE')) return 'Apple GPU'
  if (upper.includes('DIRECT3D 11') || upper.includes('D3D11')) return 'Direct3D 11'
  if (upper.includes('MESA') || upper.includes('LLVMPIPE')) return 'Software GL'
  return raw.length > 14 ? raw.slice(0, 12) + '...' : raw
}

export const SystemStatusBadge: React.FC = () => {
  const { systemStatus, settings, characterTelemetry } = useAura()

  // 1. Backend indicator
  const backendReady = systemStatus.backend === 'ready'
  const backendStarting = systemStatus.backend === 'starting'

  // 2. Ollama indicator
  const ollamaConnected = systemStatus.ollama === 'connected'
  const ollamaChecking = systemStatus.ollama === 'checking'

  // 3. AI Model indicator
  const modelVerified = ollamaConnected && systemStatus.modelInstalled === true
  const modelNeedPull = ollamaConnected && systemStatus.modelInstalled === false

  // 4. STT indicator
  const sttAvailable = systemStatus.voiceEngineStatus?.stt?.available || systemStatus.micReady
  const sttChecking = backendStarting

  // 5. TTS indicator
  const ttsAvailable = systemStatus.voiceEngineStatus?.tts?.available || systemStatus.voiceOutputReady
  const ttsChecking = backendStarting

  // 6. Microphone indicator
  const micHardwareOk = systemStatus.micHardwareAvailable !== false
  const micActive = settings.micEnabled && micHardwareOk

  // 7. Avatar indicator
  const avatarMode = characterTelemetry?.mode || 'procedural'
  const avatarLabel =
    avatarMode === 'vrm'
      ? 'VRM Character'
      : avatarMode === 'procedural'
        ? '3D Procedural'
        : 'CSS Fallback'

  // 8. WebGL indicator
  const webglOk = characterTelemetry?.webgl2Available ?? systemStatus.webglReady ?? false
  const webglError = characterTelemetry?.rendererReady === false

  // 9. GPU indicator
  const rawGpu = characterTelemetry?.gpuRenderer || systemStatus.gpuName
  const gpuDisplay = formatGpuName(rawGpu)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        borderRadius: '8px',
        background: 'rgba(19, 23, 34, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        overflowX: 'auto',
        maxWidth: '100%',
        whiteSpace: 'nowrap'
      }}
    >
      {/* 1. Backend Status */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title="Local Python Agent Service (http://127.0.0.1:8000/api/health)"
      >
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: backendReady
              ? 'var(--accent-green)'
              : backendStarting
                ? 'var(--accent-amber)'
                : 'var(--accent-crimson)',
            boxShadow: backendReady ? '0 0 6px var(--accent-green)' : 'none'
          }}
        />
        <span>Backend:</span>
        <span
          style={{
            color: backendReady
              ? 'var(--accent-green)'
              : backendStarting
                ? 'var(--accent-amber)'
                : 'var(--accent-crimson)',
            fontWeight: 600
          }}
        >
          {backendReady ? 'Ready' : backendStarting ? 'Starting...' : 'Offline'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 2. Ollama Status */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={systemStatus.errorMessage || 'Local Ollama LLM Service (http://127.0.0.1:11434)'}
      >
        <Server style={{ width: '12px', height: '12px', color: 'var(--accent-cyan)' }} />
        <span>Ollama:</span>
        <span
          style={{
            color: ollamaConnected
              ? 'var(--accent-green)'
              : ollamaChecking
                ? 'var(--accent-amber)'
                : 'var(--accent-crimson)',
            fontWeight: 600
          }}
        >
          {ollamaConnected ? 'Online' : ollamaChecking ? 'Checking...' : 'Offline'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 3. AI Model */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={`Configured Model: ${settings.modelName} ${modelVerified ? '(Verified & Loaded)' : modelNeedPull ? '(Need Pull)' : ''}`}
      >
        <Cpu style={{ width: '12px', height: '12px', color: 'var(--accent-violet)' }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{settings.modelName}</span>
        {modelVerified && <CheckCircle2 style={{ width: '11px', height: '11px', color: 'var(--accent-green)' }} />}
        {modelNeedPull && (
          <span style={{ color: 'var(--accent-amber)', fontSize: '10px', fontWeight: 600 }}>(Need Pull)</span>
        )}
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 4. STT */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={
          sttAvailable
            ? 'Local faster-whisper Speech Recognition Ready'
            : systemStatus.voiceEngineStatus?.stt?.error || 'Local faster-whisper STT Standby'
        }
      >
        <Mic
          style={{
            width: '12px',
            height: '12px',
            color: sttAvailable ? 'var(--accent-cyan)' : 'var(--text-muted)'
          }}
        />
        <span>STT:</span>
        <span
          style={{
            color: sttAvailable
              ? 'var(--accent-cyan)'
              : sttChecking
                ? 'var(--accent-amber)'
                : 'var(--text-muted)',
            fontWeight: sttAvailable ? 600 : 400
          }}
        >
          {sttAvailable ? 'faster-whisper' : sttChecking ? 'Checking...' : 'Standby'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 5. TTS */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={
          ttsAvailable
            ? 'Local Piper Text-to-Speech Ready'
            : systemStatus.voiceEngineStatus?.tts?.error || 'Local Piper TTS Standby'
        }
      >
        {ttsAvailable ? (
          <Volume2 style={{ width: '12px', height: '12px', color: 'var(--accent-green)' }} />
        ) : (
          <VolumeX style={{ width: '12px', height: '12px', color: 'var(--text-muted)' }} />
        )}
        <span>TTS:</span>
        <span
          style={{
            color: ttsAvailable
              ? 'var(--accent-green)'
              : ttsChecking
                ? 'var(--accent-amber)'
                : 'var(--text-muted)',
            fontWeight: ttsAvailable ? 600 : 400
          }}
        >
          {ttsAvailable ? 'Piper TTS' : ttsChecking ? 'Checking...' : 'Standby'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 6. Microphone Input */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={
          !settings.micEnabled
            ? 'Microphone muted in AURA settings'
            : !micHardwareOk
              ? 'No audio input devices detected'
              : 'Local Microphone capture ready'
        }
      >
        {micActive ? (
          <Mic style={{ width: '12px', height: '12px', color: 'var(--accent-cyan)' }} />
        ) : (
          <MicOff style={{ width: '12px', height: '12px', color: 'var(--accent-amber)' }} />
        )}
        <span>Mic:</span>
        <span
          style={{
            color: micActive
              ? 'var(--accent-cyan)'
              : !settings.micEnabled
                ? 'var(--text-muted)'
                : 'var(--accent-amber)',
            fontWeight: micActive ? 600 : 400
          }}
        >
          {micActive ? 'Active' : !settings.micEnabled ? 'Muted' : 'No Input'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 7. Avatar */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={`Character Engine: ${avatarLabel} (${characterTelemetry?.fps ?? 60} FPS)`}
      >
        <Bot style={{ width: '12px', height: '12px', color: 'var(--accent-violet)' }} />
        <span>Avatar:</span>
        <span
          style={{
            color:
              avatarMode === 'vrm'
                ? 'var(--accent-green)'
                : avatarMode === 'procedural'
                  ? 'var(--accent-cyan)'
                  : 'var(--accent-amber)',
            fontWeight: 600
          }}
        >
          {avatarLabel}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 8. WebGL */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={
          webglError
            ? 'WebGL Context Lost or Initialization Failed'
            : webglOk
              ? 'WebGL2 Context Verified & Active'
              : 'WebGL Context Checking...'
        }
      >
        <Layers
          style={{
            width: '12px',
            height: '12px',
            color: webglOk && !webglError ? 'var(--accent-green)' : 'var(--accent-amber)'
          }}
        />
        <span>WebGL:</span>
        <span
          style={{
            color: webglError
              ? 'var(--accent-crimson)'
              : webglOk
                ? 'var(--accent-green)'
                : 'var(--accent-amber)',
            fontWeight: webglOk && !webglError ? 600 : 400
          }}
        >
          {webglError ? 'Context Lost' : webglOk ? 'WebGL2' : 'Checking...'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 9. GPU */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={rawGpu ? `Active GPU: ${rawGpu}` : 'Active GPU detection in progress'}
      >
        <Activity style={{ width: '12px', height: '12px', color: 'var(--accent-blue)' }} />
        <span>GPU:</span>
        <span
          style={{
            color: 'var(--accent-blue)',
            fontWeight: 600
          }}
        >
          {gpuDisplay}
        </span>
      </div>
    </div>
  )
}
