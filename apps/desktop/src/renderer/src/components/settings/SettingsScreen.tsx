import React from 'react'
import { useAura } from '../../context/AuraContext'
import {
  Settings,
  Cpu,
  ShieldCheck,
  Database,
  Trash2,
  Mic,
  AlertCircle,
  Bot,
  FolderOpen,
  RotateCcw,
} from 'lucide-react'

export const SettingsScreen: React.FC = () => {
  const { settings, updateSettings, clearMessages } = useAura()

  return (
    <section
      aria-label="Application Settings"
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 32px',
        overflowY: 'auto',
        background: 'var(--bg-app)',
      }}
    >
      {/* Header */}
      <header style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Settings style={{ width: '20px', height: '20px', color: 'var(--accent-cyan)' }} />
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
            System Settings & Security Configuration
          </h1>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Configure local models, on-device voice processing, and security execution gates.
        </p>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '640px' }}>
        {/* Local Voice Subsystem Card */}
        <div
          className="glass-panel"
          style={{
            padding: '20px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-cyan)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <Mic style={{ width: '16px', height: '16px' }} />
            <span>Local Voice Interaction (faster-whisper & Piper TTS)</span>
          </div>

          {/* Voice Output Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <label
                htmlFor="voice-output-toggle"
                style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}
              >
                Spoken Assistant Responses
              </label>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                When enabled, AURA reads responses out loud locally using Piper TTS.
              </p>
            </div>
            <input
              id="voice-output-toggle"
              type="checkbox"
              checked={settings.voiceOutputEnabled}
              onChange={(e) => updateSettings({ voiceOutputEnabled: e.target.checked })}
              style={{
                width: '18px',
                height: '18px',
                accentColor: 'var(--accent-cyan)',
                cursor: 'pointer',
              }}
            />
          </div>

          {/* Volume Slider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label htmlFor="voice-volume" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Speech Playback Volume:
              </label>
              <span style={{ fontSize: '12px', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                {Math.round(settings.voiceVolume * 100)}%
              </span>
            </div>
            <input
              id="voice-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.voiceVolume}
              onChange={(e) => updateSettings({ voiceVolume: parseFloat(e.target.value) })}
              style={{
                width: '100%',
                accentColor: 'var(--accent-cyan)',
                cursor: 'pointer',
              }}
            />
          </div>

          {/* STT Language */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="stt-lang" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Speech Recognition Language:
            </label>
            <select
              id="stt-lang"
              value={settings.sttLanguage}
              onChange={(e) => updateSettings({ sttLanguage: e.target.value })}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: '#10141e',
                border: '1px solid var(--border-subtle)',
                fontSize: '13px',
                color: 'var(--text-primary)',
              }}
            >
              <option value="en">English (en - Default)</option>
              <option value="auto">Auto-detect (Requires multilingual model)</option>
            </select>
          </div>

          {/* Licensing & Setup Disclosure Box */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(0, 242, 254, 0.05)',
              border: '1px solid rgba(0, 242, 254, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '11.5px',
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-cyan)', fontWeight: 600 }}>
              <AlertCircle style={{ width: '13px', height: '13px' }} />
              <span>Voice Model Licensing & Privacy Notice</span>
            </div>
            <span>
              All audio capture and synthesis execute 100% on this workstation without cloud uploads.
              Models are not downloaded automatically. Verify voice dataset licensing:
              <code>en_US-lessac</code> is restricted to non-commercial research use; for commercial use, select <code>en_US-libritts-r</code>.
            </span>
          </div>
        </div>

        {/* Model Configuration Card */}
        <div
          className="glass-panel"
          style={{
            padding: '20px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-cyan)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <Cpu style={{ width: '16px', height: '16px' }} />
            <span>Local AI Model (Ollama)</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="model-name" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Configurable Local Model Name:
            </label>
            <input
              id="model-name"
              type="text"
              value={settings.modelName}
              onChange={(e) => updateSettings({ modelName: e.target.value })}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                fontSize: '13px',
                color: 'var(--text-primary)',
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Initially configured to <code>qwen3.5:4b</code>. You may also specify <code>qwen2.5:7b</code>, <code>llama3.2:3b</code>, etc.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="ollama-url" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Localhost Ollama Endpoint:
            </label>
            <input
              id="ollama-url"
              type="text"
              value={settings.ollamaUrl}
              onChange={(e) => updateSettings({ ollamaUrl: e.target.value })}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                fontSize: '13px',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* Animated Character & VRM Model Configuration Card */}
        <div
          className="glass-panel"
          style={{
            padding: '20px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-cyan)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <Bot style={{ width: '16px', height: '16px' }} />
            <span>Animated Character & VRM Model (Three.js & @pixiv/three-vrm)</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="vrm-path" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Configurable Local VRM Model File Path:
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                id="vrm-path"
                type="text"
                placeholder="Leave blank to use polished 3D holographic procedural fallback"
                value={settings.vrmModelPath || ''}
                onChange={(e) => updateSettings({ vrmModelPath: e.target.value })}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                type="button"
                onClick={async () => {
                  if (typeof window !== 'undefined' && window.auraAPI?.selectVrmFile) {
                    const selected = await window.auraAPI.selectVrmFile()
                    if (selected) {
                      updateSettings({ vrmModelPath: selected })
                    }
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  background: 'rgba(0, 242, 254, 0.1)',
                  border: '1px solid rgba(0, 242, 254, 0.3)',
                  color: 'var(--accent-cyan)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <FolderOpen style={{ width: '14px', height: '14px' }} />
                <span>Browse VRM...</span>
              </button>
              {settings.vrmModelPath && (
                <button
                  type="button"
                  onClick={() => updateSettings({ vrmModelPath: '' })}
                  title="Clear model and return to procedural 3D fallback"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw style={{ width: '13px', height: '13px' }} />
                  <span>Reset</span>
                </button>
              )}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Supports standard <code>.vrm</code> avatar models (VRM 0.0 & VRM 1.0). When no model is provided, AURA renders a state-reactive 3D holographic core.
            </span>
          </div>

          {/* Model Licensing & Local-First Security Box */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(0, 242, 254, 0.05)',
              border: '1px solid rgba(0, 242, 254, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              fontSize: '11.5px',
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-cyan)', fontWeight: 600 }}>
              <AlertCircle style={{ width: '13px', height: '13px' }} />
              <span>Asset Licensing & Local-First Privacy Notice</span>
            </div>
            <span>
              AURA <strong>never downloads avatar assets from the internet automatically</strong>. All 3D rendering occurs inside the local desktop interface.
              You may supply your own custom avatars created using VRoid Studio, Blender, or downloaded under CC0 / CC-BY licenses.
            </span>
          </div>
        </div>

        {/* Security & Tool Execution Policy Card */}
        <div
          className="glass-panel"
          style={{
            padding: '20px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-amber)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <ShieldCheck style={{ width: '16px', height: '16px' }} />
            <span>Tool Execution Policy & Review Mode</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="exec-policy" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Terminal & File Modification Permission Policy:
            </label>
            <select
              id="exec-policy"
              value={settings.toolExecutionPolicy}
              onChange={(e) =>
                updateSettings({
                  toolExecutionPolicy: e.target.value as 'request-review' | 'always-proceed' | 'strict',
                })
              }
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: '#10141e',
                border: '1px solid var(--border-subtle)',
                fontSize: '13px',
                color: 'var(--text-primary)',
              }}
            >
              <option value="request-review">Request Review (Recommended - Always prompt for approval)</option>
              <option value="strict">Strict (Prohibit file writes and external commands)</option>
              <option value="always-proceed">Always Proceed (Auto-approve non-destructive actions)</option>
            </select>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Ensures the assistant cannot write files or execute commands without explicit user review.
            </span>
          </div>
        </div>

        {/* Local Storage & Memory Card */}
        <div
          className="glass-panel"
          style={{
            padding: '20px',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-green)',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            <Database style={{ width: '16px', height: '16px' }} />
            <span>Workspace Boundaries & Local Storage</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label htmlFor="workspace-path" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Designated Canonical Workspace Root:
            </label>
            <input
              id="workspace-path"
              type="text"
              value={settings.workspacePath}
              onChange={(e) => updateSettings({ workspacePath: e.target.value })}
              style={{
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                fontSize: '13px',
                color: 'var(--text-primary)',
              }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              All file reads/writes are strictly jailed within this canonical directory.
            </span>
          </div>

          <div style={{ paddingTop: '8px' }}>
            <button
              type="button"
              onClick={clearMessages}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '6px',
                background: 'rgba(229, 49, 112, 0.1)',
                border: '1px solid rgba(229, 49, 112, 0.3)',
                color: 'var(--accent-crimson)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Trash2 style={{ width: '14px', height: '14px' }} />
              <span>Clear Current Session Memory</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
