import React from 'react'
import { useAura } from '../../context/AuraContext'
import { ShieldAlert, CheckCircle, XCircle, FileText } from 'lucide-react'

export const ConfirmationModal: React.FC = () => {
  const { pendingConfirmation, approveConfirmation, rejectConfirmation } = useAura()

  if (!pendingConfirmation) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div
        className="glass-panel-elevated"
        style={{
          width: '100%',
          maxWidth: '580px',
          borderRadius: '16px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          border: '1px solid rgba(255, 209, 102, 0.3)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.8), 0 0 25px rgba(255, 209, 102, 0.15)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'rgba(255, 209, 102, 0.15)',
              border: '1px solid rgba(255, 209, 102, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-amber)'
            }}
          >
            <ShieldAlert style={{ width: '22px', height: '22px' }} />
          </div>
          <div>
            <h2 id="confirm-dialog-title" style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Action Approval Required
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Execution Policy is set to <strong>Request Review</strong>. The agent requires authorization before proceeding.
            </p>
          </div>
        </div>

        {/* Action Details */}
        <div
          style={{
            background: '#0c0f17',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Requested Tool:</span>
            <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
              {pendingConfirmation.toolName}
            </span>
          </div>

          {typeof pendingConfirmation.parameters?.path === 'string' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <FileText style={{ width: '13px', height: '13px', color: 'var(--text-secondary)' }} />
              <span style={{ color: 'var(--text-muted)' }}>Target:</span>
              <code style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                {String(pendingConfirmation.parameters.path)}
              </code>
            </div>
          )}
        </div>

        {/* Diff Preview */}
        {pendingConfirmation.diffPreview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
              Proposed Code / File Diff:
            </span>
            <pre
              style={{
                maxHeight: '180px',
                overflowY: 'auto',
                background: '#07090e',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '11.5px',
                lineHeight: '1.5',
                color: '#8bd5ca'
              }}
            >
              <code>{pendingConfirmation.diffPreview}</code>
            </pre>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
          <button
            type="button"
            onClick={rejectConfirmation}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            <XCircle style={{ width: '15px', height: '15px' }} />
            <span>Reject Action</span>
          </button>

          <button
            type="button"
            onClick={approveConfirmation}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 18px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, var(--accent-amber), #e07a5f)',
              border: 'none',
              color: '#080a0f',
              fontSize: '13px',
              fontWeight: 700,
              boxShadow: '0 0 15px var(--accent-amber-glow)'
            }}
          >
            <CheckCircle style={{ width: '15px', height: '15px' }} />
            <span>Approve & Execute</span>
          </button>
        </div>
      </div>
    </div>
  )
}
