import React, { useState } from 'react'
import { useAura } from '../../context/AuraContext'
import { History, Search, MessageSquare, Trash2, ArrowRight } from 'lucide-react'

export const ConversationHistory: React.FC = () => {
  const { sessions, currentSessionId, switchSession, deleteSession } = useAura()
  const [searchTerm, setSearchTerm] = useState('')

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <section
      aria-label="Conversation History"
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '28px 32px',
        overflowY: 'auto',
        background: 'var(--bg-app)'
      }}
    >
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History style={{ width: '20px', height: '20px', color: 'var(--accent-cyan)' }} />
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Local Conversation History
            </h1>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Stored locally in SQLite. Never synchronized with external cloud databases.
          </p>
        </div>

        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            borderRadius: '8px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            width: '260px'
          }}
        >
          <Search style={{ width: '14px', height: '14px', color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search sessions..."
            aria-label="Search past conversations"
            style={{ fontSize: '12.5px', color: 'var(--text-primary)', width: '100%' }}
          />
        </div>
      </header>

      {/* Sessions Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filteredSessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            No conversation sessions matched your search.
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isCurrent = session.id === currentSessionId
            return (
              <div
                key={session.id}
                className="glass-panel"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderRadius: '12px',
                  border: isCurrent ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                  background: isCurrent ? 'rgba(0, 242, 254, 0.05)' : 'var(--bg-card)',
                  transition: 'all 150ms ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '8px',
                      background: isCurrent ? 'rgba(0, 242, 254, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      color: isCurrent ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <MessageSquare style={{ width: '18px', height: '18px' }} />
                  </div>

                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {session.title}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      <span>{session.createdAt}</span>
                      <span>•</span>
                      <span>{session.messageCount} messages</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => switchSession(session.id)}
                    aria-label={`Open session ${session.title}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '6px',
                      background: isCurrent ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.06)',
                      color: isCurrent ? '#080a0f' : 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: 600
                    }}
                  >
                    <span>{isCurrent ? 'Active' : 'Resume'}</span>
                    <ArrowRight style={{ width: '13px', height: '13px' }} />
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteSession(session.id)}
                    aria-label={`Delete session ${session.title}`}
                    style={{
                      padding: '6px',
                      borderRadius: '6px',
                      color: 'var(--text-muted)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--accent-crimson)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-muted)'
                    }}
                  >
                    <Trash2 style={{ width: '15px', height: '15px' }} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
