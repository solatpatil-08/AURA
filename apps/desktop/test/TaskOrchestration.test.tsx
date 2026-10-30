import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuraProvider } from '../src/renderer/src/context/AuraContext'
import { TaskActivityPanel } from '../src/renderer/src/components/tasks/TaskActivityPanel'
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
    fetchOrchestratedTasks: vi.fn().mockResolvedValue([
      {
        id: 'task-live-1',
        title: 'Multi-Step System Audit',
        description: 'Verify system clock and inspect workspace notes',
        state: 'running',
        current_step_index: 1,
        total_steps: 2,
        total_tool_calls: 1,
        max_total_tool_calls: 10,
        steps: [
          {
            id: 'step-1',
            step_index: 0,
            title: 'Get local time',
            tool_name: 'get_current_time',
            state: 'completed',
            result_summary: 'Current time is 13:00 UTC',
            duration_ms: 25.0
          },
          {
            id: 'step-2',
            step_index: 1,
            title: 'List project files',
            tool_name: 'list_files',
            state: 'running',
          }
        ],
        created_at: '2026-10-25T13:00:00Z',
      },
      {
        id: 'task-live-2',
        title: 'Consequential Note Creation',
        description: 'Create confidential release report',
        state: 'waiting_for_confirmation',
        current_step_index: 0,
        total_steps: 1,
        total_tool_calls: 0,
        max_total_tool_calls: 10,
        requires_confirmation: true,
        confirmation_proposal: {
          call_id: 'call-note-1',
          tool_name: 'create_note',
          parameters: { title: 'release_report.txt', content: 'v1.0 release' },
          risk_tier: 'TIER_2_MONITORED_WRITE',
          reason: 'Create or overwrite note release_report.txt',
        },
        steps: [
          {
            id: 'step-note-1',
            step_index: 0,
            title: 'Create note',
            tool_name: 'create_note',
            state: 'waiting_for_confirmation',
          }
        ],
        created_at: '2026-10-25T13:05:00Z',
      }
    ]),
    createTaskPlan: vi.fn().mockResolvedValue({
      title: 'Generated Backup Plan',
      description: 'Check time and list notes',
      steps: [
        { title: 'Check time', tool_name: 'get_current_time', parameters: {}, max_retries: 2 },
        { title: 'List notes', tool_name: 'list_files', parameters: { relative_path: 'notes' }, max_retries: 2 }
      ]
    }),
    createOrchestratedTask: vi.fn().mockResolvedValue({
      id: 'task-created-99',
      title: 'Generated Backup Plan',
      state: 'planned',
      steps: []
    }),
    executeOrchestratedTask: vi.fn().mockResolvedValue({
      id: 'task-created-99',
      state: 'completed',
    }),
    cancelOrchestratedTask: vi.fn().mockResolvedValue({
      id: 'task-live-1',
      state: 'cancelled',
    }),
    confirmOrchestratedTaskStep: vi.fn().mockResolvedValue({
      id: 'task-live-2',
      state: 'running',
    })
  }
})

describe('AURA Phase 8: Task Orchestration Activity Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Task Orchestration panel with header, live tasks, and steps', async () => {
    render(
      <AuraProvider>
        <TaskActivityPanel />
      </AuraProvider>
    )

    // Check header
    expect(screen.getByText('Task Orchestration')).toBeDefined()
    expect(screen.getByRole('button', { name: /new task/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /refresh tasks/i })).toBeDefined()

    // Wait for tasks to load from mock
    await waitFor(() => {
      expect(screen.getByText('Multi-Step System Audit')).toBeDefined()
    })

    // Verify steps progression
    expect(screen.getByText(/Get local time/)).toBeDefined()
    expect(screen.getByText(/List project files/)).toBeDefined()
  })

  it('displays confirmation review actions for consequential steps and supports user approval', async () => {
    render(
      <AuraProvider>
        <TaskActivityPanel />
      </AuraProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Consequential Note Creation')).toBeDefined()
    })

    expect(screen.getByText('Consequential Action Approval Required')).toBeDefined()
    expect(screen.getByText(/Create or overwrite note release_report.txt/)).toBeDefined()

    // Click Approve
    const approveBtn = screen.getByRole('button', { name: 'Approve' })
    fireEvent.click(approveBtn)

    expect(api.confirmOrchestratedTaskStep).toHaveBeenCalledWith('task-live-2', true, undefined)
  })

  it('supports cancelling active tasks via Cancel Task button', async () => {
    render(
      <AuraProvider>
        <TaskActivityPanel />
      </AuraProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Multi-Step System Audit')).toBeDefined()
    })

    const cancelBtns = screen.getAllByRole('button', { name: /cancel task/i })
    expect(cancelBtns.length).toBeGreaterThan(0)
    fireEvent.click(cancelBtns[0])

    expect(api.cancelOrchestratedTask).toHaveBeenCalled()
  })

  it('opens multi-step task planning modal and allows generating a plan', async () => {
    render(
      <AuraProvider>
        <TaskActivityPanel />
      </AuraProvider>
    )

    const newBtn = screen.getByRole('button', { name: /new task/i })
    fireEvent.click(newBtn)

    // Modal should appear
    expect(screen.getByText('Plan Multi-Step Task')).toBeDefined()
    const textarea = screen.getByPlaceholderText(/Check the local time/)
    fireEvent.change(textarea, { target: { value: 'Inspect project time and list files' } })

    const generateBtn = screen.getByRole('button', { name: /generate plan/i })
    fireEvent.click(generateBtn)

    await waitFor(() => {
      expect(api.createTaskPlan).toHaveBeenCalledWith('Inspect project time and list files', 'sess-1')
    })
  })
})
