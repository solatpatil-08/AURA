import React from 'react'
import { Message } from '../../types'
import { Bot, User, ShieldAlert, Check, Copy, Mic } from 'lucide-react'

interface MessageBubbleProps {
  message: Message
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user'
  const [copied, setCopied] = React.useState(false)

  const handleCopy = (): void => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <article
      style={{
        display: 'flex',
        gap: '12px',
        padding: '16px',
        borderRadius: '12px',
        background: isUser ? 'rgba(255, 255, 255, 0.03)' : 'rgba(19, 23, 34, 0.7)',
        border: isUser ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid rgba(0, 242, 254, 0.1)',
        backdropFilter: 'blur(8px)',
        alignItems: 'flex-start',
        position: 'relative',
      }}
    >
      {/* Avatar Icon */}
      <div
        style={{
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isUser
            ? 'linear-gradient(135deg, rgba(79, 172, 254, 0.2), rgba(0, 242, 254, 0.2))'
            : 'linear-gradient(135deg, rgba(127, 90, 240, 0.25), rgba(0, 242, 254, 0.25))',
          border: isUser ? '1px solid rgba(79, 172, 254, 0.3)' : '1px solid rgba(0, 242, 254, 0.3)',
          color: isUser ? 'var(--accent-blue)' : 'var(--accent-cyan)',
        }}
      >
        {isUser ? <User style={{ width: '18px', height: '18px' }} /> : <Bot style={{ width: '18px', height: '18px' }} />}
      </div>

      {/* Message Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: '13px',
                color: isUser ? 'var(--text-primary)' : 'var(--accent-cyan)',
              }}
            >
              {isUser ? 'You' : 'AURA'}
            </span>
            <time style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{message.timestamp}</time>
            {message.isVoice && (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '10px',
                  color: 'var(--accent-cyan)',
                  background: 'rgba(0, 242, 254, 0.1)',
                  padding: '1px 5px',
                  borderRadius: '4px',
                  border: '1px solid rgba(0, 242, 254, 0.2)',
                }}
              >
                <Mic style={{ width: '10px', height: '10px' }} /> Voice Input
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy message text"
              style={{
                padding: '4px',
                borderRadius: '4px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {copied ? (
                <Check style={{ width: '12px', height: '12px', color: 'var(--accent-green)' }} />
              ) : (
                <Copy style={{ width: '12px', height: '12px' }} />
              )}
            </button>
          </div>
        </header>

        {/* Text Body */}
        <div
          style={{
            fontSize: '13.5px',
            lineHeight: '1.6',
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </div>

        {/* Tool Call Proposal Pill if present */}
        {message.toolCallProposal && (
          <div
            style={{
              marginTop: '10px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(255, 209, 102, 0.08)',
              border: '1px solid rgba(255, 209, 102, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--accent-amber)',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              <ShieldAlert style={{ width: '14px', height: '14px' }} />
              <span>
                Proposed Operation: <code>{message.toolCallProposal.toolName}</code>
              </span>
            </div>

            {message.toolCallProposal.diffPreview && (
              <pre
                style={{
                  background: '#0a0d14',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '11.5px',
                  color: '#94a1b2',
                  overflowX: 'auto',
                }}
              >
                <code>{message.toolCallProposal.diffPreview}</code>
              </pre>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
