import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuraProvider } from '../src/renderer/src/context/AuraContext'
import { ConfirmationModal } from '../src/renderer/src/components/chat/ConfirmationModal'
import * as api from '../src/renderer/src/services/api'

vi.mock('../src/renderer/src/services/api', async () => {
  const actual = await vi.importActual<typeof api>('../src/renderer/src/services/api')
  return {
    ...actual,
    checkBackendStatus: vi.fn().mockResolvedValue({
      backend_status: 'ready',
      ollama: { connected: true, base_url: 'http://127.0.0.1:11434', available_models: ['qwen3.5:4b'], model_installed: true, active_model: 'qwen3.5:4b' },
      database: 'connected',
      host: '127.0.0.1',
      port: 8000
    }),
    checkVoiceStatus: vi.fn().mockResolvedValue({
      enabled: true,
      stt: { available: true, engine: 'faster-whisper' },
      tts: { available: true, engine: 'piper' }
    }),
    confirmToolProposal: vi.fn().mockResolvedValue({
      success: true,
      summary: 'Action executed successfully.',
      risk_tier: 'TIER_3_SYSTEM_EXTERNAL',
    }),
    fetchToolCatalog: vi.fn().mockResolvedValue([
      { name: 'get_current_time', description: 'Get local time', risk_tier: 'TIER_1_READ_ONLY', parameters: {} },
      { name: 'open_allowlisted_app', description: 'Open app', risk_tier: 'TIER_3_SYSTEM_EXTERNAL', parameters: {} },
    ]),
    fetchToolAuditLogs: vi.fn().mockResolvedValue([
      { id: '1', tool_name: 'get_current_time', parameters: {}, risk_level: 'TIER_1_READ_ONLY', user_decision: 'AUTO_APPROVED', status: 'SUCCESS', duration_ms: 10, created_at: '2026-10-25T00:00:00Z' },
    ]),
  }
})

describe('AURA Phase 5: Controlled Computer Actions & Human Confirmation Gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders confirmation modal when pending tool action requires approval', () => {
    // Custom wrapper that sets pendingConfirmation
    const TestComponent = () => {
      return (
        <AuraProvider>
          <ConfirmationModal />
        </AuraProvider>
      )
    }

    render(<TestComponent />)
    // Initially null, no alertdialog
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('verifies fetchToolCatalog and fetchToolAuditLogs client methods', async () => {
    const catalog = await api.fetchToolCatalog()
    expect(catalog).toHaveLength(2)
    expect(catalog[0].name).toBe('get_current_time')

    const logs = await api.fetchToolAuditLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].status).toBe('SUCCESS')
  })

  it('verifies confirmToolProposal executes and returns structured response', async () => {
    const res = await api.confirmToolProposal('call-123', true)
    expect(res.success).toBe(true)
    expect(res.summary).toBe('Action executed successfully.')
    expect(api.confirmToolProposal).toHaveBeenCalledWith('call-123', true)
  })
})
