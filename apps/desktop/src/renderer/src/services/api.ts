/**
 * Local-First API Client communicating with the AURA Python backend on 127.0.0.1.
 */

export interface VoiceStatusData {
  enabled: boolean
  stt: {
    engine?: string
    available: boolean
    model?: string
    device?: string
    error?: string | null
  }
  tts: {
    engine?: string
    available: boolean
    model_path?: string
    error?: string | null
  }
}

export interface BackendSystemStatus {
  backend_status: string
  ollama: {
    connected: boolean
    base_url: string
    available_models: string[]
    model_installed: boolean
    active_model: string
    error_message?: string | null
  }
  voice?: VoiceStatusData
  database: string
  host: string
  port: number
}

const DEFAULT_API_BASE = 'http://127.0.0.1:8000'

export async function checkBackendStatus(apiBase: string = DEFAULT_API_BASE): Promise<BackendSystemStatus | null> {
  try {
    const res = await fetch(`${apiBase}/api/system/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as BackendSystemStatus
  } catch {
    return null
  }
}

export async function checkVoiceStatus(apiBase: string = DEFAULT_API_BASE): Promise<VoiceStatusData | null> {
  try {
    const res = await fetch(`${apiBase}/api/voice/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as VoiceStatusData
  } catch {
    return null
  }
}

export async function transcribeAudio(
  audioBlob: Blob,
  filename: string = 'recording.webm',
  apiBase: string = DEFAULT_API_BASE
): Promise<{ text: string; language: string }> {
  const formData = new FormData()
  formData.append('file', audioBlob, filename)

  const res = await fetch(`${apiBase}/api/voice/transcribe`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(errJson.detail || `Transcription failed with HTTP ${res.status}`)
  }

  return await res.json()
}

export async function synthesizeSpeech(
  text: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<Blob> {
  const res = await fetch(`${apiBase}/api/voice/synthesize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/wav',
    },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(errJson.detail || `Speech synthesis failed with HTTP ${res.status}`)
  }

  return await res.blob()
}

export async function sendChatMessageStream(
  message: string,
  sessionId: string | null,
  modelName: string,
  onChunk: (delta: string) => void,
  onComplete: (data: { sessionId: string; messageId?: string }) => void,
  onError: (errMessage: string) => void,
  apiBase: string = DEFAULT_API_BASE
): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        message,
        session_id: sessionId || undefined,
        model_override: modelName,
        stream: true,
      }),
    })

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({ detail: res.statusText }))
      onError(errorJson.detail || `Request failed with status ${res.status}`)
      return
    }

    if (!res.body) {
      onError('Response stream body unavailable.')
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reading = true

    while (reading) {
      const { done, value } = await reader.read()
      if (done) {
        reading = false
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6))
            if (parsed.error) {
              onError(parsed.error)
              return
            }
            if (parsed.delta) {
              onChunk(parsed.delta)
            }
            if (parsed.done) {
              onComplete({
                sessionId: parsed.session_id,
                messageId: parsed.message_id,
              })
            }
          } catch {
            // Ignore parse errors on keepalive comments
          }
        }
      }
    }
  } catch {
    onError(
      `Cannot connect to local backend at ${apiBase}. Ensure the Python agent service is running on 127.0.0.1:8000.`
    )
  }
}

export async function fetchRemoteSessions(apiBase: string = DEFAULT_API_BASE) {
  try {
    const res = await fetch(`${apiBase}/api/sessions`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function deleteRemoteSession(sessionId: string, apiBase: string = DEFAULT_API_BASE) {
  try {
    const res = await fetch(`${apiBase}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch {
    return false
  }
}

// Phase 5: Controlled Computer Actions & Tool API Client
export interface ToolDefinition {
  name: string
  description: string
  risk_tier: string
  parameters: Record<string, unknown>
}

export interface ToolExecutionResult {
  success: boolean
  data?: unknown
  summary: string
  error?: string | null
  recovery_options?: string[] | null
  risk_tier: string
  requires_confirmation?: boolean
  confirmation_proposal?: {
    call_id: string
    tool_name: string
    parameters: Record<string, unknown>
    risk_tier: string
    reason: string
    diff_preview?: string | null
  } | null
}

export interface ToolAuditLog {
  id: string
  session_id?: string | null
  tool_name: string
  parameters: Record<string, unknown>
  risk_level: string
  user_decision: string
  status: string
  duration_ms: number
  result_summary?: string | null
  error_message?: string | null
  created_at: string
}

export async function fetchToolCatalog(apiBase: string = DEFAULT_API_BASE): Promise<ToolDefinition[]> {
  try {
    const res = await fetch(`${apiBase}/api/tools/catalog`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function executeTool(
  toolName: string,
  parameters: Record<string, unknown> = {},
  userConfirmed: boolean = false,
  sessionId?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<ToolExecutionResult> {
  const res = await fetch(`${apiBase}/api/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool_name: toolName,
      parameters,
      user_confirmed: userConfirmed,
      session_id: sessionId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Tool execution failed: HTTP ${res.status}`)
  }
  return await res.json()
}

export async function confirmToolProposal(
  callId: string,
  approved: boolean,
  sessionId?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<ToolExecutionResult> {
  const res = await fetch(`${apiBase}/api/tools/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      call_id: callId,
      approved,
      session_id: sessionId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Tool confirmation failed: HTTP ${res.status}`)
  }
  return await res.json()
}

export async function fetchToolAuditLogs(
  limit: number = 50,
  apiBase: string = DEFAULT_API_BASE
): Promise<ToolAuditLog[]> {
  try {
    const res = await fetch(`${apiBase}/api/tools/audit?limit=${limit}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

// Phase 8: Task Orchestration Client
export async function createTaskPlan(
  userRequest: string,
  sessionId?: string,
  modelOverride?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<{ title: string; description: string; steps: Array<{ title: string; tool_name: string; parameters: Record<string, unknown>; max_retries: number }> }> {
  const res = await fetch(`${apiBase}/api/tasks/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_request: userRequest,
      session_id: sessionId,
      model_override: modelOverride,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Plan generation failed: HTTP ${res.status}`)
  }
  return await res.json()
}

export interface OrchestratedTaskStep {
  id: string
  step_index: number
  title: string
  tool_name: string
  parameters: Record<string, unknown>
  state: 'pending' | 'waiting_for_confirmation' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'
  retry_count: number
  max_retries: number
  side_effect_occurred: boolean
  result_summary?: string | null
  result_data?: unknown
  error_message?: string | null
  duration_ms: number
}

export interface OrchestratedTask {
  id: string
  session_id?: string | null
  title: string
  description: string
  state: 'planned' | 'waiting_for_confirmation' | 'running' | 'completed' | 'failed' | 'cancelled'
  current_step_index: number
  total_steps: number
  steps: OrchestratedTaskStep[]
  total_tool_calls: number
  max_total_tool_calls: number
  error_message?: string | null
  final_report?: string | null
  requires_confirmation: boolean
  confirmation_proposal?: {
    call_id: string
    tool_name: string
    parameters: Record<string, unknown>
    risk_tier: string
    reason: string
    diff_preview?: string | null
  } | null
  created_at: string
  updated_at: string
  completed_at?: string | null
}

export async function createOrchestratedTask(
  title: string,
  description: string,
  steps: Array<{ title: string; tool_name: string; parameters: Record<string, unknown>; max_retries?: number }>,
  sessionId?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<OrchestratedTask> {
  const res = await fetch(`${apiBase}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description,
      steps,
      session_id: sessionId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Create task failed: HTTP ${res.status}`)
  }
  return await res.json()
}

export async function executeOrchestratedTask(
  taskId: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<OrchestratedTask> {
  const res = await fetch(`${apiBase}/api/tasks/${taskId}/execute`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Task execution failed: HTTP ${res.status}`)
  }
  return await res.json()
}

export async function fetchOrchestratedTasks(
  sessionId?: string,
  state?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<OrchestratedTask[]> {
  try {
    let url = `${apiBase}/api/tasks?limit=50`
    if (sessionId) url += `&session_id=${encodeURIComponent(sessionId)}`
    if (state) url += `&state=${encodeURIComponent(state)}`
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

export async function confirmOrchestratedTaskStep(
  taskId: string,
  approved: boolean,
  guidance?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<OrchestratedTask> {
  const res = await fetch(`${apiBase}/api/tasks/${taskId}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved, guidance }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Task confirmation failed: HTTP ${res.status}`)
  }
  return await res.json()
}

export async function cancelOrchestratedTask(
  taskId: string,
  reason?: string,
  apiBase: string = DEFAULT_API_BASE
): Promise<OrchestratedTask> {
  const res = await fetch(`${apiBase}/api/tasks/${taskId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason || 'Cancelled by user' }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Task cancellation failed: HTTP ${res.status}`)
  }
  return await res.json()
}

