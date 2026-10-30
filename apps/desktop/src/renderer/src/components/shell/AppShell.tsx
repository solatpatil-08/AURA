import React from 'react'
import { useAura } from '../../context/AuraContext'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { ConversationArea } from '../chat/ConversationArea'
import { AvatarStage } from '../avatar/AvatarStage'
import { TaskActivityPanel } from '../tasks/TaskActivityPanel'
import { ConversationHistory } from '../history/ConversationHistory'
import { MemoryReviewScreen } from '../memory/MemoryReviewScreen'
import { SettingsScreen } from '../settings/SettingsScreen'
import { SystemStatusBadge } from '../status/SystemStatusBadge'

export const AppShell: React.FC = () => {
  const { activeTab } = useAura()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-app)'
      }}
    >
      {/* Sleek Custom Desktop TitleBar */}
      <TitleBar />

      {/* Main Body Layout: Sidebar + Active View + Optional Task Drawer */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Navigation Sidebar */}
        <Sidebar />

        {/* Central View Area */}
        <div style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
          {activeTab === 'chat' && (
            <>
              <ConversationArea />
              <TaskActivityPanel />
            </>
          )}

          {activeTab === 'stage' && <AvatarStage />}
          {activeTab === 'tasks' && <TaskActivityPanel />}
          {activeTab === 'memory' && <MemoryReviewScreen />}
          {activeTab === 'history' && <ConversationHistory />}
          {activeTab === 'settings' && <SettingsScreen />}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <footer
        style={{
          height: '32px',
          background: '#0a0c12',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}
      >
        <SystemStatusBadge />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>Offline Autonomous Operation</span>
          <span>•</span>
          <span style={{ color: 'var(--accent-cyan)' }}>Localhost Only</span>
        </div>
      </footer>
    </div>
  )
}
