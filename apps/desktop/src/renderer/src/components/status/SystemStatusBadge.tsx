import React from 'react'
import { useAura } from '../../context/AuraContext'
import { Server, Cpu, HardDrive, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'

export const SystemStatusBadge: React.FC = () => {
  const { systemStatus, settings } = useAura()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 12px',
        borderRadius: '8px',
        background: 'rgba(19, 23, 34, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
      }}
    >
      {/* Backend Status */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        title="Python Agent Backend Status (127.0.0.1:8000)"
      >
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background:
              systemStatus.backend === 'ready' ? 'var(--accent-green)' : 'var(--accent-crimson)',
            boxShadow: systemStatus.backend === 'ready' ? '0 0 6px var(--accent-green)' : 'none',
          }}
        />
        <span>Backend:</span>
        <span
          style={{
            color: systemStatus.backend === 'ready' ? 'var(--accent-green)' : 'var(--accent-crimson)',
            fontWeight: 600,
          }}
        >
          {systemStatus.backend === 'ready' ? 'Ready' : 'Offline'}
        </span>
      </div>

      <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)' }} />

      {/* Ollama Status */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        title={systemStatus.errorMessage || 'Ollama Local Daemon'}
      >
        <Server style={{ width: '13px', height: '13px', color: 'var(--accent-cyan)' }} />
        <span>Ollama:</span>
        <span
          style={{
            color: systemStatus.ollama === 'connected' ? 'var(--accent-green)' : 'var(--accent-crimson)',
            fontWeight: 600,
          }}
        >
          {systemStatus.ollama === 'connected' ? 'Online' : 'Offline'}
        </span>
      </div>

      <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)' }} />

      {/* Model Name & Installation State */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        title={
          systemStatus.modelInstalled === false
            ? `Model not installed. Run 'ollama run ${settings.modelName}'`
            : `Active Local LLM: ${settings.modelName}`
        }
      >
        <Cpu style={{ width: '13px', height: '13px', color: 'var(--accent-violet)' }} />
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{settings.modelName}</span>
        {systemStatus.modelInstalled === false && (
          <span style={{ color: 'var(--accent-amber)', fontSize: '10px', fontWeight: 600 }}>
            (Need Pull)
          </span>
        )}
      </div>

      <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)' }} />

      {/* Memory Footprint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title="Heap Memory Usage">
        <HardDrive style={{ width: '13px', height: '13px', color: 'var(--accent-blue)' }} />
        <span>{systemStatus.memoryMb} MB</span>
      </div>

      <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)' }} />

      {/* Mic / STT Status */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        title={
          systemStatus.micReady
            ? 'faster-whisper STT Ready'
            : systemStatus.voiceEngineStatus?.stt?.error || 'Local Whisper model not installed'
        }
      >
        {systemStatus.micReady ? (
          <Mic style={{ width: '13px', height: '13px', color: 'var(--accent-cyan)' }} />
        ) : (
          <MicOff style={{ width: '13px', height: '13px', color: 'var(--text-muted)' }} />
        )}
        <span
          style={{
            color: systemStatus.micReady ? 'var(--accent-cyan)' : 'var(--text-muted)',
            fontWeight: systemStatus.micReady ? 600 : 400,
          }}
        >
          {systemStatus.micReady ? 'STT Ready' : 'STT Standby'}
        </span>
      </div>

      <div style={{ width: '1px', height: '12px', background: 'var(--border-subtle)' }} />

      {/* TTS / Speaker Status */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        title={
          systemStatus.voiceOutputReady
            ? 'Piper TTS Ready'
            : systemStatus.voiceEngineStatus?.tts?.error || 'Local Piper voice not installed'
        }
      >
        {systemStatus.voiceOutputReady ? (
          <Volume2 style={{ width: '13px', height: '13px', color: 'var(--accent-green)' }} />
        ) : (
          <VolumeX style={{ width: '13px', height: '13px', color: 'var(--text-muted)' }} />
        )}
        <span
          style={{
            color: systemStatus.voiceOutputReady ? 'var(--accent-green)' : 'var(--text-muted)',
            fontWeight: systemStatus.voiceOutputReady ? 600 : 400,
          }}
        >
          {systemStatus.voiceOutputReady ? 'TTS Ready' : 'TTS Standby'}
        </span>
      </div>
    </div>
  )
}
