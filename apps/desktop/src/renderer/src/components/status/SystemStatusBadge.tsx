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
  const { systemStatus, settings, characterTelemetry, assistantState } = useAura()

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
  const sttChecking = backendStarting && !sttAvailable

  // 5. TTS indicator with 3-tier health checks (Model available, Synthesis ready, Playback ready)
  const ttsModelAvailable = systemStatus.ttsModelAvailable ?? Boolean(systemStatus.voiceEngineStatus?.tts?.model_available ?? systemStatus.voiceEngineStatus?.tts?.available)
  const ttsSynthesisReady = systemStatus.ttsSynthesisReady ?? Boolean(systemStatus.voiceEngineStatus?.tts?.synthesis_ready ?? systemStatus.voiceEngineStatus?.tts?.available)
  const ttsPlaybackReady = systemStatus.ttsPlaybackReady ?? (settings.voiceOutputEnabled && systemStatus.voiceOutputReady !== false)

  const ttsFullReady = ttsModelAvailable && ttsSynthesisReady && ttsPlaybackReady

  const ttsTooltip = `Piper TTS Health: Model [${ttsModelAvailable ? '✓ Available' : '✗ Missing'}] · Synthesis [${ttsSynthesisReady ? '✓ Ready' : '✗ Not Ready'}] · Playback [${ttsPlaybackReady ? '✓ Armed' : '✗ Muted/Disabled'}]`

  let ttsLabel = 'Piper TTS'
  let ttsColor = 'var(--accent-green)'
  if (backendStarting) {
    ttsLabel = 'Checking...'
    ttsColor = 'var(--accent-amber)'
  } else if (!backendReady) {
    ttsLabel = 'Offline'
    ttsColor = 'var(--text-muted)'
  } else if (!ttsModelAvailable) {
    ttsLabel = 'Model Missing'
    ttsColor = 'var(--accent-amber)'
  } else if (!ttsSynthesisReady) {
    ttsLabel = 'Synthesis Error'
    ttsColor = 'var(--accent-crimson)'
  } else if (!ttsPlaybackReady) {
    ttsLabel = 'Playback Muted'
    ttsColor = 'var(--text-muted)'
  } else {
    ttsLabel = 'Piper TTS'
    ttsColor = 'var(--accent-green)'
  }

  // 6. Microphone indicator with granular states
  const micStatus =
    assistantState === 'listening'
      ? 'recording'
      : systemStatus.micStatus ||
        (!settings.micEnabled
          ? 'muted'
          : systemStatus.micHardwareAvailable === false
            ? 'no_device'
            : 'ready')

  const micBadgeConfig: Record<string, { label: string; color: string; title: string }> = {
    muted: { label: 'Muted', color: 'var(--text-muted)', title: 'Microphone muted in privacy settings' },
    recording: { label: 'Recording', color: 'var(--accent-crimson)', title: 'Active audio recording in progress' },
    recording_failed: { label: 'Recording Failed', color: 'var(--accent-crimson)', title: 'Audio capture stream failed' },
    permission_denied: { label: 'Permission Denied', color: 'var(--accent-amber)', title: 'Microphone permission blocked in Windows Settings' },
    no_device: { label: 'No Device Detected', color: 'var(--accent-amber)', title: 'No physical audio input devices detected' },
    ready: { label: 'Device Available', color: 'var(--accent-cyan)', title: 'Local microphone capture armed and ready' }
  }

  const micConfig = micBadgeConfig[micStatus] || micBadgeConfig.ready

  // 7. Avatar indicator
  const avatarMode = characterTelemetry?.mode || 'procedural'
  const avatarLabel =
    avatarMode === 'vrm'
      ? 'VRM Character'
      : avatarMode === 'procedural'
        ? '3D Procedural'
        : 'CSS Fallback'

  // 8. WebGL indicator (Strict context loss check: Only flag Context Lost on actual loss event)
  const webglOk = characterTelemetry?.webgl2Available ?? systemStatus.webglReady ?? false
  const webglLost = characterTelemetry?.isContextLost === true || systemStatus.isContextLost === true

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
        title={systemStatus.errorMessage || 'Local Python Agent Service (http://127.0.0.1:8000/api/health)'}
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
          {backendReady ? 'Ready' : backendStarting ? 'Starting...' : 'Stopped'}
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
        title={
          modelVerified
            ? `Active Model '${systemStatus.activeModel}' verified in local Ollama`
            : modelNeedPull
              ? `Model '${systemStatus.activeModel}' requires pulling: ollama pull ${systemStatus.activeModel}`
              : `Configured Model: ${systemStatus.activeModel}`
        }
      >
        <Cpu style={{ width: '12px', height: '12px', color: 'var(--accent-purple)' }} />
        <span>Model:</span>
        <span
          style={{
            color: modelVerified
              ? 'var(--accent-purple)'
              : modelNeedPull
                ? 'var(--accent-amber)'
                : 'var(--text-muted)',
            fontWeight: 600
          }}
        >
          {systemStatus.activeModel || 'qwen3.5:4b'}
        </span>
        {modelVerified && (
          <span title="Model verified ready in local repository" style={{ display: 'inline-flex' }}>
            <CheckCircle2
              style={{ width: '11px', height: '11px', color: 'var(--accent-green)' }}
            />
          </span>
        )}
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 4. STT */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={
          sttAvailable
            ? 'Local faster-whisper Speech Recognition Ready'
            : systemStatus.voiceEngineStatus?.stt?.error || 'Local faster-whisper STT'
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
          {sttAvailable
            ? 'faster-whisper'
            : sttChecking
              ? 'Checking...'
              : backendReady
                ? 'Unavailable'
                : 'Offline'}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 5. TTS */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={ttsTooltip}
      >
        {ttsFullReady ? (
          <Volume2 style={{ width: '12px', height: '12px', color: ttsColor }} />
        ) : (
          <VolumeX style={{ width: '12px', height: '12px', color: ttsColor }} />
        )}
        <span>TTS:</span>
        <span
          style={{
            color: ttsColor,
            fontWeight: ttsFullReady ? 600 : 400
          }}
        >
          {ttsLabel}
        </span>
      </div>

      <div style={{ width: '1px', height: '10px', background: 'var(--border-subtle)' }} />

      {/* 6. Microphone Input */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}
        title={micConfig.title}
      >
        {micStatus === 'muted' || micStatus === 'no_device' ? (
          <MicOff style={{ width: '12px', height: '12px', color: micConfig.color }} />
        ) : (
          <Mic style={{ width: '12px', height: '12px', color: micConfig.color }} />
        )}
        <span>Mic:</span>
        <span
          style={{
            color: micConfig.color,
            fontWeight: micStatus === 'ready' || micStatus === 'recording' ? 600 : 400
          }}
        >
          {micConfig.label}
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
          webglLost
            ? 'WebGL graphics context was lost'
            : webglOk
              ? 'WebGL2 Graphics Acceleration Verified & Active'
              : 'WebGL Context Standby'
        }
      >
        <Layers
          style={{
            width: '12px',
            height: '12px',
            color: webglLost ? 'var(--accent-crimson)' : webglOk ? 'var(--accent-green)' : 'var(--text-muted)'
          }}
        />
        <span>WebGL:</span>
        <span
          style={{
            color: webglLost
              ? 'var(--accent-crimson)'
              : webglOk
                ? 'var(--accent-green)'
                : 'var(--text-muted)',
            fontWeight: webglOk && !webglLost ? 600 : 400
          }}
        >
          {webglLost ? 'Context Lost' : webglOk ? 'WebGL2' : 'Standby'}
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
