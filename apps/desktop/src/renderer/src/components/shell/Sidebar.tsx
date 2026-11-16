import React from 'react'
import { MessageSquare, Sparkles, Activity, Brain, History, Settings, Bot } from 'lucide-react'
import { useAura } from '../../context/AuraContext'
import { NavTab } from '../../types'

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, systemStatus } = useAura()

  const navItems: {
    id: NavTab
    label: string
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  }[] = [
    { id: 'stage', label: 'Companion Home', icon: Bot },
    { id: 'chat', label: 'Conversation', icon: MessageSquare },
    { id: 'skills', label: 'Skills', icon: Sparkles },
    { id: 'tasks', label: 'Tasks & Audit', icon: Activity },
    { id: 'memory', label: 'Memory', icon: Brain },
    { id: 'history', label: 'History', icon: History },
    { id: 'settings', label: 'Settings', icon: Settings }
  ]

  const isTabActive = (itemId: NavTab): boolean => {
    if (itemId === 'stage' || itemId === 'avatar' || itemId === 'home') return activeTab === 'stage' || activeTab === 'home' || activeTab === 'avatar'
    if (itemId === 'tasks') return activeTab === 'tasks' || activeTab === 'activity'
    return activeTab === itemId
  }

  return (
    <aside
      aria-label="Sidebar Navigation"
      style={{
        width: '72px',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0',
        gap: '20px',
        flexShrink: 0,
        zIndex: 10
      }}
    >
      {/* Brand Holographic Orb */}
      <button
        type="button"
        onClick={() => setActiveTab('stage')}
        title="AURA Companion Stage"
        style={{
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.25), rgba(127, 90, 240, 0.25))',
          border: '1px solid var(--border-accent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-cyan)',
          boxShadow: '0 0 16px var(--accent-cyan-glow)',
          cursor: 'pointer'
        }}
      >
        <Bot style={{ width: '22px', height: '22px' }} />
      </button>

      {/* Nav List */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', alignItems: 'center' }}>
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = isTabActive(item.id)
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              aria-label={item.label}
              title={item.label}
              style={{
                position: 'relative',
                width: '46px',
                height: '46px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                background: isActive ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                border: isActive ? '1px solid rgba(0, 242, 254, 0.3)' : '1px solid transparent',
                boxShadow: isActive ? '0 0 14px var(--accent-cyan-glow)' : 'none',
                transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)'
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text-primary)'
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.color = 'var(--text-muted)'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: '3px',
                    height: '22px',
                    borderRadius: '0 4px 4px 0',
                    background: 'var(--accent-cyan)',
                    boxShadow: '0 0 10px var(--accent-cyan)'
                  }}
                />
              )}
              <Icon style={{ width: '20px', height: '20px' }} />
            </button>
          )
        })}
      </nav>

      {/* Bottom status orb */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: systemStatus.backend === 'ready' ? 'var(--accent-green)' : 'var(--accent-amber)',
            boxShadow:
              systemStatus.backend === 'ready'
                ? '0 0 8px var(--accent-green-glow)'
                : '0 0 8px var(--accent-amber-glow)'
          }}
          title={systemStatus.backend === 'ready' ? 'Local Backend Online' : 'Backend Initializing'}
        />
      </div>
    </aside>
  )
}
