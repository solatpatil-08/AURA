import React from 'react'
import { Minus, Square, X, Shield, Activity } from 'lucide-react'
import { StateBadge } from '../common/StateBadge'
import { useAura } from '../../context/AuraContext'

export const TitleBar: React.FC = () => {
  const { assistantState, toggleTaskPanel, isTaskPanelOpen } = useAura()

  const handleMinimize = (): void => {
    if (window.auraAPI?.minimize) {
      window.auraAPI.minimize()
    }
  }

  const handleMaximize = (): void => {
    if (window.auraAPI?.maximize) {
      window.auraAPI.maximize()
    }
  }

  const handleClose = (): void => {
    if (window.auraAPI?.close) {
      window.auraAPI.close()
    }
  }

  return (
    <header
      style={{
        height: '42px',
        background: 'var(--bg-app)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        WebkitAppRegion: 'drag',
        userSelect: 'none'
      } as React.CSSProperties}
    >
      {/* Brand Title & Security Tag */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '2px',
              background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-violet))',
              boxShadow: '0 0 8px var(--accent-cyan-glow)'
            }}
          />
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.08em', color: 'var(--text-primary)' }}>
            AURA
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Desktop v0.1.0
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '4px',
            background: 'rgba(0, 242, 254, 0.08)',
            border: '1px solid rgba(0, 242, 254, 0.2)',
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--accent-cyan)'
          }}
          title="Running 100% locally with zero external API dependencies"
        >
          <Shield style={{ width: '10px', height: '10px' }} />
          <span>Local-First Sandbox</span>
        </div>
      </div>

      {/* Center: Interactive Assistant State Indicator */}
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <StateBadge state={assistantState} interactive={true} />
      </div>

      {/* Right Controls: Task Panel Toggle & Window Buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          onClick={toggleTaskPanel}
          aria-label="Toggle Task Activity Panel"
          title="Toggle Task Activity Panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            borderRadius: '6px',
            background: isTaskPanelOpen ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
            border: '1px solid var(--border-subtle)',
            color: isTaskPanelOpen ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            fontSize: '11px',
            fontWeight: 600
          }}
        >
          <Activity style={{ width: '13px', height: '13px' }} />
          <span>Activity</span>
        </button>

        <div style={{ width: '1px', height: '16px', background: 'var(--border-subtle)', margin: '0 4px' }} />

        {/* Window controls */}
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimize Window"
          style={{
            padding: '6px',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Minus style={{ width: '13px', height: '13px' }} />
        </button>

        <button
          type="button"
          onClick={handleMaximize}
          aria-label="Maximize Window"
          style={{
            padding: '6px',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <Square style={{ width: '11px', height: '11px' }} />
        </button>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Close Window"
          style={{
            padding: '6px',
            borderRadius: '4px',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#e53170'
            e.currentTarget.style.background = 'rgba(229, 49, 112, 0.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <X style={{ width: '13px', height: '13px' }} />
        </button>
      </div>
    </header>
  )
}
