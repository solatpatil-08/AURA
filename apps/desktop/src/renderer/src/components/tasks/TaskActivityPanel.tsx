import React, { useState } from 'react'
import { useAura } from '../../context/AuraContext'
import {
  Activity,
  CheckCircle2,
  Clock,
  ShieldAlert,
  AlertCircle,
  FileText,
  X,
  RefreshCw,
  Plus,
  Play,
  Ban,
  ChevronDown,
  ChevronRight,
  Loader2
} from 'lucide-react'
import { createTaskPlan, createOrchestratedTask, executeOrchestratedTask } from '../../services/api'

interface GeneratedPlanStep {
  title: string
  tool_name: string
  parameters: Record<string, unknown>
  max_retries?: number
}

interface GeneratedPlan {
  title: string
  description: string
  steps: GeneratedPlanStep[]
}

export const TaskActivityPanel: React.FC = () => {
  const { tasks, isTaskPanelOpen, toggleTaskPanel, refreshTasks, cancelTaskById, confirmTaskById, currentSessionId } = useAura()
  const [expandedReports, setExpandedReports] = useState<Record<string, boolean>>({})
  const [isPlanningModalOpen, setIsPlanningModalOpen] = useState(false)
  const [planPrompt, setPlanPrompt] = useState('')
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  if (!isTaskPanelOpen) return null

  const toggleReport = (taskId: string) => {
    setExpandedReports((prev) => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return {
          icon: CheckCircle2,
          color: 'var(--accent-green)',
          bg: 'rgba(44, 182, 125, 0.1)',
          label: 'Completed'
        }
      case 'waiting_for_confirmation':
      case 'requires_approval':
        return {
          icon: ShieldAlert,
          color: 'var(--accent-amber)',
          bg: 'rgba(255, 137, 6, 0.15)',
          label: 'Awaiting Review'
        }
      case 'running':
      case 'in_progress':
        return {
          icon: Loader2,
          color: 'var(--accent-cyan)',
          bg: 'rgba(0, 242, 254, 0.15)',
          label: 'Running'
        }
      case 'failed':
        return {
          icon: AlertCircle,
          color: '#f87171',
          bg: 'rgba(239, 68, 68, 0.15)',
          label: 'Failed'
        }
      case 'cancelled':
        return {
          icon: Ban,
          color: 'var(--text-muted)',
          bg: 'rgba(255, 255, 255, 0.05)',
          label: 'Cancelled'
        }
      default:
        return {
          icon: Clock,
          color: 'var(--text-muted)',
          bg: 'rgba(255, 255, 255, 0.05)',
          label: status.charAt(0).toUpperCase() + status.slice(1)
        }
    }
  }

  const handleGeneratePlan = async () => {
    if (!planPrompt.trim()) return
    setIsGeneratingPlan(true)
    setPlanError(null)
    setGeneratedPlan(null)

    try {
      const plan = await createTaskPlan(planPrompt, currentSessionId)
      setGeneratedPlan(plan)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate task plan'
      setPlanError(message)
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  const handleExecuteGeneratedPlan = async () => {
    if (!generatedPlan) return
    setIsGeneratingPlan(true)
    try {
      const createdTask = await createOrchestratedTask(
        generatedPlan.title,
        generatedPlan.description,
        generatedPlan.steps,
        currentSessionId
      )
      setIsPlanningModalOpen(false)
      setPlanPrompt('')
      setGeneratedPlan(null)
      await refreshTasks()

      // Start execution in background
      executeOrchestratedTask(createdTask.id)
        .then(() => refreshTasks())
        .catch(() => refreshTasks())
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to launch task'
      setPlanError(message)
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  return (
    <aside
      aria-label="Task Activity and Audit Panel"
      style={{
        width: '360px',
        background: 'var(--bg-sidebar)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flexShrink: 0
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(15, 23, 42, 0.6)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity style={{ width: '16px', height: '16px', color: 'var(--accent-cyan)' }} />
          <h2 style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>
            Task Orchestration
          </h2>
          <span
            style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '10px',
              background: 'rgba(0, 242, 254, 0.1)',
              color: 'var(--accent-cyan)',
              fontWeight: 600
            }}
          >
            {tasks.length}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setIsPlanningModalOpen(true)}
            aria-label="New Task"
            title="Create multi-step task"
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'rgba(0, 242, 254, 0.12)',
              color: 'var(--accent-cyan)',
              border: '1px solid rgba(0, 242, 254, 0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Plus style={{ width: '12px', height: '12px' }} />
            New
          </button>

          <button
            type="button"
            onClick={() => refreshTasks()}
            aria-label="Refresh tasks"
            title="Refresh from server"
            style={{
              padding: '5px',
              borderRadius: '4px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none'
            }}
          >
            <RefreshCw style={{ width: '13px', height: '13px' }} />
          </button>

          <button
            type="button"
            onClick={toggleTaskPanel}
            aria-label="Close task activity panel"
            style={{
              padding: '5px',
              borderRadius: '4px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none'
            }}
          >
            <X style={{ width: '14px', height: '14px' }} />
          </button>
        </div>
      </header>

      {/* Task List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 16px', fontSize: '13px' }}>
            <Activity style={{ width: '28px', height: '28px', margin: '0 auto 10px', opacity: 0.3 }} />
            No task operations recorded. Click <strong>+ New</strong> to plan a multi-step task.
          </div>
        ) : (
          tasks.map((task) => {
            const badge = getStatusBadge(task.status)
            const BadgeIcon = badge.icon
            const isWaiting = task.status === 'waiting_for_confirmation' || task.status === 'requires_approval'
            const isRunning = task.status === 'running' || task.status === 'in_progress'

            return (
              <div
                key={task.id}
                className="glass-panel"
                style={{
                  borderRadius: '10px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  border: isWaiting
                    ? '1px solid var(--accent-amber)'
                    : isRunning
                    ? '1px solid var(--accent-cyan)'
                    : '1px solid var(--border-subtle)',
                  background: isWaiting
                    ? 'rgba(255, 137, 6, 0.04)'
                    : isRunning
                    ? 'rgba(0, 242, 254, 0.03)'
                    : 'var(--bg-card)'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <h3 style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {task.title}
                  </h3>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: badge.bg,
                      color: badge.color,
                      fontSize: '10px',
                      fontWeight: 600,
                      flexShrink: 0
                    }}
                  >
                    <BadgeIcon style={{ width: '11px', height: '11px', animation: isRunning ? 'spin 1.5s linear infinite' : 'none' }} />
                    <span>{badge.label}</span>
                  </span>
                </div>

                {task.description && (
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {task.description}
                  </p>
                )}

                {/* Target Path info if any */}
                {task.targetPath && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <FileText style={{ width: '12px', height: '12px' }} />
                    <code style={{ fontSize: '10px', wordBreak: 'break-all' }}>{task.targetPath}</code>
                  </div>
                )}

                {/* Steps Progression List */}
                {task.steps && task.steps.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                      padding: '8px',
                      borderRadius: '6px',
                      background: 'rgba(0, 0, 0, 0.35)',
                      border: '1px solid rgba(255, 255, 255, 0.04)'
                    }}
                  >
                    {task.steps.map((step, idx) => {
                      const stepCompleted = step.completed || step.state === 'completed'
                      const stepRunning = step.state === 'running'
                      const stepWaiting = step.state === 'waiting_for_confirmation'
                      const stepFailed = step.state === 'failed'

                      let stepIcon = <Clock style={{ width: '11px', height: '11px', color: 'var(--text-muted)' }} />
                      if (stepCompleted) {
                        stepIcon = <CheckCircle2 style={{ width: '11px', height: '11px', color: 'var(--accent-green)' }} />
                      } else if (stepRunning) {
                        stepIcon = <Loader2 style={{ width: '11px', height: '11px', color: 'var(--accent-cyan)', animation: 'spin 1s linear infinite' }} />
                      } else if (stepWaiting) {
                        stepIcon = <ShieldAlert style={{ width: '11px', height: '11px', color: 'var(--accent-amber)' }} />
                      } else if (stepFailed) {
                        stepIcon = <AlertCircle style={{ width: '11px', height: '11px', color: '#f87171' }} />
                      }

                      return (
                        <div
                          key={step.id || idx}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            fontSize: '11px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {stepIcon}
                              <span style={{ color: stepCompleted || stepRunning ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                {step.title || step.label}
                              </span>
                            </div>
                            {step.tool_name && (
                              <code style={{ fontSize: '9.5px', color: 'var(--accent-cyan)', opacity: 0.8 }}>
                                {step.tool_name}
                              </code>
                            )}
                          </div>

                          {step.result_summary && (
                            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', paddingLeft: '17px', opacity: 0.85 }}>
                              {step.result_summary}
                            </div>
                          )}

                          {step.error_message && (
                            <div style={{ fontSize: '10px', color: '#f87171', paddingLeft: '17px' }}>
                              Error: {step.error_message}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Confirmation Review Actions */}
                {isWaiting && (
                  <div
                    style={{
                      background: 'rgba(255, 137, 6, 0.1)',
                      border: '1px solid rgba(255, 137, 6, 0.3)',
                      borderRadius: '6px',
                      padding: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px'
                    }}
                  >
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent-amber)' }}>
                      Consequential Action Approval Required
                    </div>
                    {task.confirmation_proposal?.reason && (
                      <div style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                        {task.confirmation_proposal.reason}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <button
                        type="button"
                        onClick={() => confirmTaskById(task.id, true)}
                        style={{
                          flex: 1,
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: 'var(--accent-green)',
                          color: '#000',
                          fontSize: '11px',
                          fontWeight: 600,
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmTaskById(task.id, false, 'User declined via task panel')}
                        style={{
                          flex: 1,
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Cancel Button for active tasks */}
                {(isRunning || isWaiting) && (
                  <button
                    type="button"
                    onClick={() => cancelTaskById(task.id, 'Cancelled from task activity panel')}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: 'transparent',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-muted)',
                      fontSize: '10.5px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    <Ban style={{ width: '11px', height: '11px' }} />
                    Cancel Task
                  </button>
                )}

                {/* Final Report Accordion */}
                {task.final_report && (
                  <div style={{ marginTop: '2px' }}>
                    <button
                      type="button"
                      onClick={() => toggleReport(task.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--accent-cyan)',
                        fontSize: '10.5px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      {expandedReports[task.id] ? (
                        <ChevronDown style={{ width: '12px', height: '12px' }} />
                      ) : (
                        <ChevronRight style={{ width: '12px', height: '12px' }} />
                      )}
                      {expandedReports[task.id] ? 'Hide Report' : 'View Execution Report'}
                    </button>

                    {expandedReports[task.id] && (
                      <pre
                        style={{
                          marginTop: '6px',
                          padding: '8px',
                          background: '#090c12',
                          borderRadius: '4px',
                          fontSize: '10px',
                          color: 'var(--text-secondary)',
                          whiteSpace: 'pre-wrap',
                          maxHeight: '180px',
                          overflowY: 'auto'
                        }}
                      >
                        {task.final_report}
                      </pre>
                    )}
                  </div>
                )}

                {/* Footer metadata */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--text-muted)', paddingTop: '4px' }}>
                  <span>
                    {task.total_tool_calls !== undefined
                      ? `Calls: ${task.total_tool_calls}/${task.max_total_tool_calls ?? 10}`
                      : ''}
                  </span>
                  <span>{task.timestamp}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* New Task Planning Modal */}
      {isPlanningModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: '420px',
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              background: '#0f172a',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Plan Multi-Step Task
              </h3>
              <button
                type="button"
                onClick={() => setIsPlanningModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X style={{ width: '16px', height: '16px' }} />
              </button>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Enter an objective in natural language. AURA will generate a validated, ordered step-by-step plan using the local tool registry.
            </p>

            <textarea
              value={planPrompt}
              onChange={(e) => setPlanPrompt(e.target.value)}
              placeholder="e.g., Check the local time, list project notes, and create a task summary note."
              rows={3}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                background: '#070b14',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                resize: 'none'
              }}
            />

            {planError && (
              <div style={{ fontSize: '11px', color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '4px' }}>
                {planError}
              </div>
            )}

            {generatedPlan && (
              <div
                style={{
                  background: 'rgba(0,0,0,0.4)',
                  padding: '10px',
                  borderRadius: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  maxHeight: '180px',
                  overflowY: 'auto'
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                  {generatedPlan.title} ({generatedPlan.steps.length} steps)
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  {generatedPlan.description}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                  {generatedPlan.steps.map((s: GeneratedPlanStep, i: number) => (
                    <div key={i} style={{ fontSize: '10.5px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>{i + 1}.</span>
                      <span>{s.title}</span>
                      <code style={{ fontSize: '9px', color: 'var(--accent-cyan)' }}>{s.tool_name}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={() => setIsPlanningModalOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>

              {!generatedPlan ? (
                <button
                  type="button"
                  onClick={handleGeneratePlan}
                  disabled={isGeneratingPlan || !planPrompt.trim()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    background: 'var(--accent-cyan)',
                    color: '#000',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: isGeneratingPlan ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: isGeneratingPlan || !planPrompt.trim() ? 0.6 : 1
                  }}
                >
                  {isGeneratingPlan ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} /> : null}
                  Generate Plan
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleExecuteGeneratedPlan}
                  disabled={isGeneratingPlan}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    background: 'var(--accent-green)',
                    color: '#000',
                    fontSize: '12px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Play style={{ width: '13px', height: '13px' }} />
                  Execute Task
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
