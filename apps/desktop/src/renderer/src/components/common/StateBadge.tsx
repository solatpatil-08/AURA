import React from 'react'
import { AssistantState } from '../../types'
import {
  Sparkles,
  Mic,
  Cpu,
  Volume2,
  Terminal,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  Activity,
  XCircle
} from 'lucide-react'
import { useAura } from '../../context/AuraContext'

interface StateBadgeProps {
  state: AssistantState
  interactive?: boolean
}

const stateConfig: Record<
  AssistantState,
  { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; bg: string; glow: string }
> = {
  idle: {
    label: 'Idle',
    icon: Sparkles,
    color: '#00f2fe',
    bg: 'rgba(0, 242, 254, 0.1)',
    glow: '0 0 10px rgba(0, 242, 254, 0.3)'
  },
  listening: {
    label: 'Listening',
    icon: Mic,
    color: '#2cb67d',
    bg: 'rgba(44, 182, 125, 0.12)',
    glow: '0 0 12px rgba(44, 182, 125, 0.4)'
  },
  transcribing: {
    label: 'Transcribing',
    icon: Activity,
    color: '#f5a623',
    bg: 'rgba(245, 166, 35, 0.15)',
    glow: '0 0 12px rgba(245, 166, 35, 0.4)'
  },
  thinking: {
    label: 'Thinking',
    icon: Cpu,
    color: '#7f5af0',
    bg: 'rgba(127, 90, 240, 0.15)',
    glow: '0 0 12px rgba(127, 90, 240, 0.4)'
  },
  responding: {
    label: 'Responding',
    icon: Volume2,
    color: '#4facfe',
    bg: 'rgba(79, 172, 254, 0.15)',
    glow: '0 0 12px rgba(79, 172, 254, 0.4)'
  },
  speaking: {
    label: 'Speaking',
    icon: Volume2,
    color: '#4facfe',
    bg: 'rgba(79, 172, 254, 0.15)',
    glow: '0 0 12px rgba(79, 172, 254, 0.4)'
  },
  executing: {
    label: 'Executing Task',
    icon: Terminal,
    color: '#ff8906',
    bg: 'rgba(255, 137, 6, 0.15)',
    glow: '0 0 12px rgba(255, 137, 6, 0.4)'
  },
  waiting_confirmation: {
    label: 'Waiting for Review',
    icon: ShieldAlert,
    color: '#ffd166',
    bg: 'rgba(255, 209, 102, 0.15)',
    glow: '0 0 14px rgba(255, 209, 102, 0.5)'
  },
  cancelled: {
    label: 'Cancelled',
    icon: XCircle,
    color: '#a0aec0',
    bg: 'rgba(160, 174, 192, 0.15)',
    glow: '0 0 10px rgba(160, 174, 192, 0.3)'
  },
  error: {
    label: 'System Error',
    icon: AlertTriangle,
    color: '#e53170',
    bg: 'rgba(229, 49, 112, 0.15)',
    glow: '0 0 12px rgba(229, 49, 112, 0.4)'
  }
}

export const StateBadge: React.FC<StateBadgeProps> = ({ state, interactive = false }) => {
  const { setAssistantState } = useAura()
  const [isOpen, setIsOpen] = React.useState(false)
  const current = stateConfig[state] || stateConfig.idle
  const Icon = current.icon

  const statesList: AssistantState[] = [
    'idle',
    'listening',
    'thinking',
    'responding',
    'executing',
    'waiting_confirmation',
    'error'
  ]

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => interactive && setIsOpen(!isOpen)}
        aria-label={`Current Assistant State: ${current.label}${interactive ? ' (Click to test state)' : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '4px 10px',
          borderRadius: '9999px',
          background: current.bg,
          border: `1px solid ${current.color}40`,
          boxShadow: current.glow,
          color: current.color,
          fontSize: '12px',
          fontWeight: 600,
          cursor: interactive ? 'pointer' : 'default',
          transition: 'all 200ms ease'
        }}
      >
        <span
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: current.color,
            boxShadow: `0 0 8px ${current.color}`,
            display: 'inline-block'
          }}
        />
        <Icon style={{ width: '13px', height: '13px' }} />
        <span>{current.label}</span>
        {interactive && <ChevronDown style={{ width: '12px', height: '12px', opacity: 0.7 }} />}
      </button>

      {interactive && isOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 100,
            background: '#131722',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            padding: '6px',
            width: '180px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.7)',
            backdropFilter: 'blur(16px)'
          }}
        >
          <div
            style={{
              padding: '4px 8px',
              fontSize: '10px',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              fontWeight: 700,
              letterSpacing: '0.05em'
            }}
          >
            Switch State (Test)
          </div>
          {statesList.map((s) => {
            const item = stateConfig[s]
            const ItemIcon = item.icon
            return (
              <button
                key={s}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAssistantState(s)
                  setIsOpen(false)
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  borderRadius: '5px',
                  fontSize: '12px',
                  color: s === state ? item.color : 'var(--text-secondary)',
                  background: s === state ? item.bg : 'transparent',
                  textAlign: 'left'
                }}
              >
                <ItemIcon style={{ width: '14px', height: '14px' }} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
