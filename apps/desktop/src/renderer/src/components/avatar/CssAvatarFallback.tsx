import React from 'react'
import { AssistantState } from '../../types'
import { Sparkles, Radio, Cpu, Volume2, Layers, ShieldAlert, AlertTriangle, RefreshCw } from 'lucide-react'

interface CssAvatarFallbackProps {
  assistantState: AssistantState
  isSpeaking: boolean
  onRetryWebGL?: () => void
  errorMessage?: string
}

const STATE_CONFIG: Record<
  AssistantState,
  {
    primaryColor: string
    secondaryColor: string
    glowColor: string
    label: string
    icon: React.ComponentType<{ style?: React.CSSProperties }>
  }
> = {
  idle: {
    primaryColor: '#00f2fe',
    secondaryColor: '#4facfe',
    glowColor: 'rgba(0, 242, 254, 0.35)',
    label: 'Core Ambient Monitoring',
    icon: Sparkles
  },
  listening: {
    primaryColor: '#2cb67d',
    secondaryColor: '#1f9463',
    glowColor: 'rgba(44, 182, 125, 0.4)',
    label: 'Audio Capture Active',
    icon: Radio
  },
  transcribing: {
    primaryColor: '#f5a623',
    secondaryColor: '#d98218',
    glowColor: 'rgba(245, 166, 35, 0.4)',
    label: 'Speech Recognition Active',
    icon: Sparkles
  },
  thinking: {
    primaryColor: '#7f5af0',
    secondaryColor: '#643fe3',
    glowColor: 'rgba(127, 90, 240, 0.45)',
    label: 'Neural Reasoning Active',
    icon: Cpu
  },
  responding: {
    primaryColor: '#4facfe',
    secondaryColor: '#00f2fe',
    glowColor: 'rgba(79, 172, 254, 0.4)',
    label: 'Speech Synthesizing',
    icon: Volume2
  },
  speaking: {
    primaryColor: '#4facfe',
    secondaryColor: '#00f2fe',
    glowColor: 'rgba(79, 172, 254, 0.45)',
    label: 'Voice Output Active',
    icon: Volume2
  },
  executing: {
    primaryColor: '#ff8906',
    secondaryColor: '#e57800',
    glowColor: 'rgba(255, 137, 6, 0.4)',
    label: 'Executing System Actions',
    icon: Layers
  },
  waiting_confirmation: {
    primaryColor: '#ffd166',
    secondaryColor: '#f4b942',
    glowColor: 'rgba(255, 209, 102, 0.45)',
    label: 'Approval Gate Active',
    icon: ShieldAlert
  },
  cancelled: {
    primaryColor: '#a0aec0',
    secondaryColor: '#718096',
    glowColor: 'rgba(160, 174, 192, 0.25)',
    label: 'Operation Cancelled',
    icon: Sparkles
  },
  error: {
    primaryColor: '#e53170',
    secondaryColor: '#c42058',
    glowColor: 'rgba(229, 49, 112, 0.5)',
    label: 'Anomaly Intercepted',
    icon: AlertTriangle
  }
}

/**
 * Pure CSS/SVG Compatibility Avatar.
 * Zero dependency on Three.js, WebGL2, or canvas contexts.
 * Renders an animated cybernetic holographic avatar responding in real-time to assistant states.
 */
export const CssAvatarFallback: React.FC<CssAvatarFallbackProps> = ({
  assistantState,
  isSpeaking,
  onRetryWebGL,
  errorMessage
}) => {
  const currentConfig = STATE_CONFIG[assistantState] || STATE_CONFIG.idle
  const StateIcon = currentConfig.icon

  return (
    <div
      role="region"
      aria-label="CSS/SVG Compatibility Avatar"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '280px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at center, rgba(10, 14, 22, 0.95) 0%, #06080d 100%)',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Ambient background glow ring */}
      <div
        style={{
          position: 'absolute',
          width: '320px',
          height: '320px',
          borderRadius: '50%',
          background: currentConfig.glowColor,
          filter: 'blur(60px)',
          opacity: 0.6,
          transition: 'background 500ms ease, opacity 500ms ease',
          pointerEvents: 'none'
        }}
      />

      {/* Interactive Cybernetic SVG Core */}
      <svg
        viewBox="0 0 300 300"
        style={{
          width: '260px',
          height: '260px',
          zIndex: 2,
          filter: `drop-shadow(0 0 20px ${currentConfig.glowColor})`
        }}
      >
        <defs>
          <linearGradient id="coreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={currentConfig.primaryColor} />
            <stop offset="100%" stopColor={currentConfig.secondaryColor} />
          </linearGradient>

          <radialGradient id="orbGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="40%" stopColor={currentConfig.primaryColor} stopOpacity="0.8" />
            <stop offset="100%" stopColor={currentConfig.secondaryColor} stopOpacity="0.0" />
          </radialGradient>
        </defs>

        {/* Outer Orbit Segment 1 */}
        <circle
          cx="150"
          cy="150"
          r="130"
          fill="none"
          stroke={currentConfig.primaryColor}
          strokeWidth="1.5"
          strokeDasharray="40 18 10 18"
          opacity="0.45"
          style={{
            transformOrigin: '150px 150px',
            animation: 'auraRotateCw 24s linear infinite'
          }}
        />

        {/* Outer Orbit Segment 2 */}
        <circle
          cx="150"
          cy="150"
          r="115"
          fill="none"
          stroke={currentConfig.secondaryColor}
          strokeWidth="1.5"
          strokeDasharray="60 25"
          opacity="0.35"
          style={{
            transformOrigin: '150px 150px',
            animation: 'auraRotateCcw 18s linear infinite'
          }}
        />

        {/* Mid Ring Geometric Brackets */}
        <circle
          cx="150"
          cy="150"
          r="92"
          fill="none"
          stroke={currentConfig.primaryColor}
          strokeWidth="2"
          strokeDasharray="18 12 6 12"
          opacity="0.7"
          style={{
            transformOrigin: '150px 150px',
            animation: 'auraRotateCw 12s linear infinite'
          }}
        />

        {/* Inner Counter-Rotating Hex Ring */}
        <polygon
          points="150,85 206,117 206,183 150,215 94,183 94,117"
          fill="none"
          stroke={currentConfig.primaryColor}
          strokeWidth="1.5"
          opacity="0.55"
          style={{
            transformOrigin: '150px 150px',
            animation: 'auraRotateCcw 9s linear infinite'
          }}
        />

        {/* Core Pulsing Orb */}
        <circle
          cx="150"
          cy="150"
          r={isSpeaking ? '46' : '40'}
          fill="url(#orbGlow)"
          style={{
            transformOrigin: '150px 150px',
            animation: isSpeaking ? 'auraPulseRapid 600ms ease-in-out infinite' : 'auraPulseSlow 3s ease-in-out infinite',
            transition: 'r 200ms ease'
          }}
        />

        {/* Center Target Reticle */}
        <circle cx="150" cy="150" r="14" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.85" />
        <line x1="150" y1="130" x2="150" y2="138" stroke="#ffffff" strokeWidth="1.5" />
        <line x1="150" y1="162" x2="150" y2="170" stroke="#ffffff" strokeWidth="1.5" />
        <line x1="130" y1="150" x2="138" y2="150" stroke="#ffffff" strokeWidth="1.5" />
        <line x1="162" y1="150" x2="170" y2="150" stroke="#ffffff" strokeWidth="1.5" />
      </svg>

      {/* Voice Waveform Frequency Visualizer when Speaking */}
      {isSpeaking && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            height: '24px',
            marginTop: '10px',
            zIndex: 3
          }}
        >
          {[14, 22, 10, 26, 18, 24, 12, 20, 16].map((h, i) => (
            <div
              key={i}
              style={{
                width: '3px',
                height: `${h}px`,
                borderRadius: '2px',
                background: currentConfig.primaryColor,
                animation: `auraWaveform 500ms ease-in-out infinite alternate ${i * 60}ms`
              }}
            />
          ))}
        </div>
      )}

      {/* Status Bar */}
      <div
        style={{
          marginTop: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          zIndex: 3
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '5px 14px',
            borderRadius: '20px',
            background: 'rgba(255, 255, 255, 0.04)',
            border: `1px solid ${currentConfig.primaryColor}50`,
            backdropFilter: 'blur(8px)'
          }}
        >
          <StateIcon style={{ width: '14px', height: '14px', color: currentConfig.primaryColor }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {currentConfig.label}
          </span>
        </div>

        {/* Fallback mode indicator badge */}
        <span
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span>Compatibility Avatar (CSS/SVG Fallback • Standby)</span>
          {onRetryWebGL && (
            <button
              onClick={onRetryWebGL}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(0, 242, 254, 0.12)',
                border: '1px solid rgba(0, 242, 254, 0.3)',
                color: '#00f2fe',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                marginLeft: '6px'
              }}
            >
              <RefreshCw style={{ width: '10px', height: '10px' }} />
              Retry 3D WebGL
            </button>
          )}
        </span>

        {errorMessage && (
          <span style={{ fontSize: '10px', color: '#ff8ba7', maxWidth: '340px', textAlign: 'center' }}>
            {errorMessage}
          </span>
        )}
      </div>

      {/* Embedded Animation Keyframes */}
      <style>{`
        @keyframes auraRotateCw {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes auraRotateCcw {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @keyframes auraPulseSlow {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        @keyframes auraPulseRapid {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.18); opacity: 1; }
        }
        @keyframes auraWaveform {
          from { transform: scaleY(0.4); }
          to { transform: scaleY(1.3); }
        }
      `}</style>
    </div>
  )
}

