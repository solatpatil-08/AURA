import React, { useRef, useEffect } from 'react'
import { useAura } from '../../context/AuraContext'
import { MessageBubble } from './MessageBubble'
import { ConfirmationModal } from './ConfirmationModal'
import { ChatInput } from './ChatInput'
import { Bot, AlertCircle, Loader2 } from 'lucide-react'

export const ConversationArea: React.FC = () => {
  const { messages, assistantState, sendMessage } = useAura()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, assistantState])

  const samplePrompts = [
    'Analyze local project structure and report findings',
    'Simulate writing a configuration update file',
    'Check local Ollama daemon connection status',
    'Verify canonical path safety for active workspace'
  ]

  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        position: 'relative',
        background: 'radial-gradient(circle at 50% 20%, rgba(18, 23, 35, 0.4) 0%, rgba(8, 10, 15, 0.95) 100%)'
      }}
    >
      <ConfirmationModal />

      {/* Messages Scroll Area */}
      <div
        role="log"
        aria-label="Conversation messages"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        {messages.length === 0 ? (
          /* Empty State */
          <div
            style={{
              margin: 'auto',
              maxWidth: '460px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px',
              padding: '32px'
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.15), rgba(127, 90, 240, 0.15))',
                border: '1px solid var(--border-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-cyan)',
                boxShadow: '0 0 20px var(--accent-cyan-glow)'
              }}
            >
              <Bot style={{ width: '28px', height: '28px' }} />
            </div>

            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                AURA Local Assistant
              </h1>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                Your workstation companion running 100% locally. Zero remote telemetry, fully auditable actions, and local memory.
              </p>
            </div>

            {/* Quick Sample Prompts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '8px' }}>
              {samplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)',
                    fontSize: '12.5px',
                    textAlign: 'left',
                    transition: 'all 200ms ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 242, 254, 0.06)'
                    e.currentTarget.style.borderColor = 'var(--accent-cyan)'
                    e.currentTarget.style.color = 'var(--text-primary)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                >
                  <span style={{ color: 'var(--accent-cyan)', marginRight: '6px' }}>&rsaquo;</span>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Rendered Messages */
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}

        {/* Dynamic Thinking / Responding Banner */}
        {assistantState === 'thinking' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: 'rgba(127, 90, 240, 0.1)',
              border: '1px solid rgba(127, 90, 240, 0.3)',
              color: 'var(--accent-violet)',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <Loader2 style={{ width: '16px', height: '16px', animation: 'spinSlow 2s linear infinite' }} />
            <span>AURA is reasoning with local model...</span>
          </div>
        )}

        {assistantState === 'executing' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: 'rgba(255, 137, 6, 0.1)',
              border: '1px solid rgba(255, 137, 6, 0.3)',
              color: 'var(--accent-amber)',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <Loader2 style={{ width: '16px', height: '16px', animation: 'spinSlow 2s linear infinite' }} />
            <span>Executing approved tool operation safely...</span>
          </div>
        )}

        {assistantState === 'error' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 16px',
              borderRadius: '10px',
              background: 'rgba(229, 49, 112, 0.12)',
              border: '1px solid rgba(229, 49, 112, 0.35)',
              color: 'var(--accent-crimson)',
              fontSize: '13px',
              fontWeight: 500
            }}
          >
            <AlertCircle style={{ width: '16px', height: '16px' }} />
            <span>An error occurred in the reasoning pipeline. Please check the system logs.</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input Bar */}
      <ChatInput />
    </main>
  )
}
