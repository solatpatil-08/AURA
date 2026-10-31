export type AssistantState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'responding'
  | 'speaking'
  | 'executing'
  | 'waiting_confirmation'
  | 'cancelled'
  | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  state?: AssistantState
  isVoice?: boolean
  toolCallProposal?: {
    callId?: string
    toolName: string
    parameters: Record<string, unknown>
    diffPreview?: string
    reason?: string
    riskTier?: string
  }
}

export type TaskState =
  | 'planned'
  | 'waiting_for_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'pending'
  | 'in_progress'
  | 'requires_approval'

export type StepState =
  | 'pending'
  | 'waiting_for_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export interface TaskStep {
  id: string
  label?: string
  title?: string
  completed?: boolean
  step_index?: number
  tool_name?: string
  parameters?: Record<string, unknown>
  state?: StepState
  retry_count?: number
  max_retries?: number
  side_effect_occurred?: boolean
  result_summary?: string | null
  result_data?: unknown
  error_message?: string | null
  duration_ms?: number
}

export interface TaskItem {
  id: string
  title: string
  description: string
  status: TaskState
  toolName?: string
  targetPath?: string
  steps: TaskStep[]
  outcome?: string
  timestamp: string
  current_step_index?: number
  total_steps?: number
  total_tool_calls?: number
  max_total_tool_calls?: number
  error_message?: string | null
  final_report?: string | null
  requires_confirmation?: boolean
  confirmation_proposal?: {
    call_id: string
    tool_name: string
    parameters: Record<string, unknown>
    risk_tier: string
    reason: string
    diff_preview?: string | null
  } | null
  created_at?: string
  updated_at?: string
  completed_at?: string | null
}

export interface VoiceEngineDetails {
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

export interface SystemStatus {
  ollama: 'connected' | 'offline' | 'checking'
  backend: 'ready' | 'starting' | 'stopped'
  activeModel: string
  modelInstalled?: boolean
  errorMessage?: string | null
  memoryMb: number
  micReady: boolean
  voiceOutputReady?: boolean
  voiceEngineStatus?: VoiceEngineDetails
}

export interface Session {
  id: string
  title: string
  createdAt: string
  messageCount: number
}

export interface AppSettings {
  modelName: string
  ollamaUrl: string
  toolExecutionPolicy: 'request-review' | 'always-proceed' | 'strict'
  themeMode: 'dark'
  accentColor: string
  soundEffects: boolean
  workspacePath: string
  voiceOutputEnabled: boolean
  voiceVolume: number
  sttLanguage: string
  vrmModelPath?: string
}

export type CharacterRenderMode = 'procedural' | 'vrm'

export interface CharacterTelemetry {
  mode: CharacterRenderMode
  modelName: string
  state: AssistantState
  isSpeaking: boolean
  fps: number
  error: string | null
}

export interface MemoryItem {
  id: string
  category: 'preference' | 'fact' | 'project' | 'instruction' | 'general'
  key?: string | null
  content: string
  source_session_id?: string | null
  confidence: number
  access_count: number
  last_accessed_at?: string | null
  created_at: string
  updated_at: string
  expires_at?: string | null
  is_pinned: boolean
  metadata_json?: string | null
}

export type NavTab = 'chat' | 'stage' | 'tasks' | 'memory' | 'history' | 'settings'
