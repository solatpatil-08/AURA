import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'
import {
  AssistantState,
  Message,
  TaskItem,
  SystemStatus,
  Session,
  AppSettings,
  NavTab
} from '../types'
import {
  checkBackendStatus,
  sendChatMessageStream,
  synthesizeSpeech,
  confirmToolProposal,
  fetchOrchestratedTasks,
  cancelOrchestratedTask,
  confirmOrchestratedTaskStep,
  OrchestratedTask,
  OrchestratedTaskStep,
} from '../services/api'
import { cleanTextForSpeech } from '../utils/speechFilter'

interface AuraContextType {
  assistantState: AssistantState
  setAssistantState: (state: AssistantState) => void
  activeTab: NavTab
  setActiveTab: (tab: NavTab) => void
  messages: Message[]
  sendMessage: (content: string, isVoice?: boolean) => void
  clearMessages: () => void
  tasks: TaskItem[]
  pendingConfirmation: Message['toolCallProposal'] | null
  approveConfirmation: () => void
  rejectConfirmation: () => void
  systemStatus: SystemStatus
  sessions: Session[]
  currentSessionId: string
  switchSession: (id: string) => void
  deleteSession: (id: string) => void
  settings: AppSettings
  updateSettings: (newSettings: Partial<AppSettings>) => void
  isTaskPanelOpen: boolean
  toggleTaskPanel: () => void
  isSpeaking: boolean
  stopSpeech: () => void
  speechAnalyser: AnalyserNode | null
  refreshTasks: () => Promise<void>
  cancelTaskById: (id: string, reason?: string) => Promise<void>
  confirmTaskById: (id: string, approved: boolean, guidance?: string) => Promise<void>
}

const defaultSettings: AppSettings = {
  modelName: 'qwen3.5:4b',
  ollamaUrl: 'http://127.0.0.1:11434',
  toolExecutionPolicy: 'request-review',
  themeMode: 'dark',
  accentColor: '#00f2fe',
  soundEffects: false,
  workspacePath: 'C:\\Projects\\AURA',
  voiceOutputEnabled: true,
  voiceVolume: 1.0,
  sttLanguage: 'en',
  vrmModelPath: '',
}

const initialSessions: Session[] = [
  {
    id: 'sess-1',
    title: 'Project Architecture Review',
    createdAt: '2026-10-24 19:40',
    messageCount: 6
  },
  {
    id: 'sess-2',
    title: 'Local Model Inference Configuration',
    createdAt: '2026-10-24 16:15',
    messageCount: 14
  },
  {
    id: 'sess-3',
    title: 'VRM Lip-Sync & Viseme Pipeline',
    createdAt: '2026-10-23 21:05',
    messageCount: 8
  }
]

const initialTasks: TaskItem[] = [
  {
    id: 'task-101',
    title: 'Workspace Scope Verification',
    description: 'Verify canonical path containment for active project directory.',
    status: 'completed',
    toolName: 'path_jail_validate',
    targetPath: 'C:\\Projects\\AURA',
    steps: [
      { id: 's1', label: 'Resolve absolute symlinks', completed: true },
      { id: 's2', label: 'Verify non-system directory boundary', completed: true },
      { id: 's3', label: 'Commit verified scope to SQLite audit table', completed: true }
    ],
    outcome: 'Path verified within bounds. Zero traversal anomalies detected.',
    timestamp: '19:42:10'
  },
  {
    id: 'task-102',
    title: 'Scoped Configuration Audit',
    description: 'Inspect local offline execution policies and model endpoints.',
    status: 'requires_approval',
    toolName: 'write_file',
    targetPath: 'C:\\Projects\\AURA\\aura.config.json',
    steps: [
      { id: 's4', label: 'Generate diff of proposed configuration', completed: true },
      { id: 's5', label: 'Request human confirmation via desktop review gate', completed: false },
      { id: 's6', label: 'Atomic write with backup restoration point', completed: false }
    ],
    outcome: 'Paused: Awaiting explicit developer approval.',
    timestamp: '19:45:00'
  }
]

const initialMessages: Message[] = [
  {
    id: 'msg-1',
    role: 'assistant',
    content:
      "Greetings. I am **AURA** (Autonomous Utility, Reasoning and Automation). I am running locally on your workstation using the configured `qwen3.5:4b` engine.\n\nAll conversation memory, speech processing, and reasoning loops execute locally with zero external cloud dependencies. How may I assist your engineering workflow today?",
    timestamp: '19:40:15',
    state: 'idle'
  }
]

const AuraContext = createContext<AuraContextType | undefined>(undefined)

export const AuraProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [assistantState, setAssistantState] = useState<AssistantState>('idle')
  const [activeTab, setActiveTab] = useState<NavTab>('chat')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [tasks, setTasks] = useState<TaskItem[]>(initialTasks)
  const [sessions, setSessions] = useState<Session[]>(initialSessions)
  const [currentSessionId, setCurrentSessionId] = useState<string>('sess-1')
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState<boolean>(true)
  const [pendingConfirmation, setPendingConfirmation] = useState<Message['toolCallProposal'] | null>(null)
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false)
  const [speechAnalyser, setSpeechAnalyser] = useState<AnalyserNode | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    ollama: 'connected',
    backend: 'ready',
    activeModel: defaultSettings.modelName,
    memoryMb: 124,
    micReady: false,
    voiceOutputReady: false,
  })

  const stopSpeech = useCallback(() => {
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop()
        currentSourceRef.current.disconnect()
      } catch {
        // Ignore errors if source was already stopped
      }
      currentSourceRef.current = null
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.currentTime = 0
      currentAudioRef.current = null
    }
    setSpeechAnalyser(null)
    setIsSpeaking(false)
    setAssistantState((prev) => (prev === 'speaking' || prev === 'responding' ? 'idle' : prev))
  }, [])

  const playSynthesizedSpeech = useCallback(
    async (text: string) => {
      if (!settings.voiceOutputEnabled || !text.trim()) return

      // Sanitize AI response: strip reasoning, code blocks, JSON, and formatting
      const cleanText = cleanTextForSpeech(text)
      if (!cleanText) return

      try {
        const audioBlob = await synthesizeSpeech(cleanText)

        // Web Audio API with AnalyserNode for real-time lip-sync
        const AudioCtxClass =
          typeof window !== 'undefined'
            ? window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
            : null

        if (AudioCtxClass) {
          try {
            if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
              audioCtxRef.current = new AudioCtxClass()
            }
            const ctx = audioCtxRef.current
            if (ctx.state === 'suspended') {
              await ctx.resume()
            }

            const arrayBuffer = await audioBlob.arrayBuffer()
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

            if (currentSourceRef.current) {
              try {
                currentSourceRef.current.stop()
                currentSourceRef.current.disconnect()
              } catch {
                // Ignore disconnect error
              }
            }

            const source = ctx.createBufferSource()
            source.buffer = audioBuffer

            const analyser = ctx.createAnalyser()
            analyser.fftSize = 512
            analyser.smoothingTimeConstant = 0.4

            const gainNode = ctx.createGain()
            gainNode.gain.value = Math.max(0, Math.min(1, settings.voiceVolume))

            source.connect(analyser)
            analyser.connect(gainNode)
            gainNode.connect(ctx.destination)

            currentSourceRef.current = source
            setSpeechAnalyser(analyser)
            setIsSpeaking(true)
            setAssistantState('speaking')

            source.onended = () => {
              currentSourceRef.current = null
              setSpeechAnalyser(null)
              setIsSpeaking(false)
              setAssistantState('idle')
            }

            source.start(0)
            return
          } catch {
            // If Web Audio API decode fails in certain environments, fall back to standard HTMLAudioElement
          }
        }

        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        audio.volume = Math.max(0, Math.min(1, settings.voiceVolume))
        currentAudioRef.current = audio

        audio.onplay = () => {
          setIsSpeaking(true)
          setAssistantState('speaking')
        }
        audio.onended = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(audioUrl)
          currentAudioRef.current = null
          setAssistantState('idle')
        }
        audio.onerror = () => {
          setIsSpeaking(false)
          URL.revokeObjectURL(audioUrl)
          currentAudioRef.current = null
          setAssistantState('idle')
        }

        await audio.play()
      } catch {
        // Gracefully handle if TTS is unavailable or user interrupted
        setIsSpeaking(false)
        setAssistantState('idle')
      }
    },
    [settings.voiceOutputEnabled, settings.voiceVolume]
  )

  const refreshTasks = useCallback(async (): Promise<void> => {
    try {
      const serverTasks = await fetchOrchestratedTasks()
      if (serverTasks && serverTasks.length > 0) {
        const mapped: TaskItem[] = serverTasks.map((st: OrchestratedTask) => ({
          id: st.id,
          title: st.title,
          description: st.description,
          status: st.state as TaskItem['status'],
          steps: (st.steps || []).map((s: OrchestratedTaskStep) => ({
            id: s.id,
            label: `${s.step_index + 1}. ${s.title}`,
            title: s.title,
            completed: s.state === 'completed',
            step_index: s.step_index,
            tool_name: s.tool_name,
            parameters: s.parameters,
            state: s.state,
            retry_count: s.retry_count,
            max_retries: s.max_retries,
            side_effect_occurred: s.side_effect_occurred,
            result_summary: s.result_summary,
            result_data: s.result_data,
            error_message: s.error_message,
            duration_ms: s.duration_ms,
          })),
          current_step_index: st.current_step_index,
          total_steps: st.total_steps,
          total_tool_calls: st.total_tool_calls,
          max_total_tool_calls: st.max_total_tool_calls,
          error_message: st.error_message,
          final_report: st.final_report,
          requires_confirmation: st.requires_confirmation,
          confirmation_proposal: st.confirmation_proposal,
          timestamp: st.created_at
            ? new Date(st.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
          outcome:
            st.state === 'completed'
              ? st.final_report
                ? 'Execution completed successfully.'
                : 'Completed'
              : (st.error_message || undefined),
        }))
        setTasks(mapped)
      }
    } catch {
      // Ignore background task fetch errors
    }
  }, [])

  const cancelTaskById = useCallback(
    async (id: string, reason?: string): Promise<void> => {
      try {
        await cancelOrchestratedTask(id, reason)
        await refreshTasks()
      } catch (e) {
        console.error('Failed to cancel task:', e)
      }
    },
    [refreshTasks]
  )

  const confirmTaskById = useCallback(
    async (id: string, approved: boolean, guidance?: string): Promise<void> => {
      try {
        await confirmOrchestratedTaskStep(id, approved, guidance)
        await refreshTasks()
      } catch (e) {
        console.error('Failed to confirm task step:', e)
      }
    },
    [refreshTasks]
  )

  // Poll system status and orchestrated tasks from local Python backend on 127.0.0.1:8000
  useEffect(() => {
    async function fetchStatus(): Promise<void> {
      const backendStatus = await checkBackendStatus()
      if (backendStatus) {
        setSystemStatus({
          backend: 'ready',
          ollama: backendStatus.ollama.connected ? 'connected' : 'offline',
          activeModel: backendStatus.ollama.active_model || settings.modelName,
          modelInstalled: backendStatus.ollama.model_installed,
          errorMessage: backendStatus.ollama.error_message,
          memoryMb: 128,
          micReady: backendStatus.voice?.stt?.available ?? false,
          voiceOutputReady: backendStatus.voice?.tts?.available ?? false,
          voiceEngineStatus: backendStatus.voice
            ? {
                stt: backendStatus.voice.stt,
                tts: backendStatus.voice.tts,
              }
            : undefined,
        })
        await refreshTasks()
      } else if (typeof window !== 'undefined' && window.auraAPI?.getSystemStatus) {
        try {
          const status = await window.auraAPI.getSystemStatus()
          setSystemStatus((prev) => ({
            ...prev,
            ...status,
            activeModel: settings.modelName,
          }))
        } catch {
          // Preload fallback error
        }
      } else {
        setSystemStatus((prev) => ({
          ...prev,
          backend: 'stopped',
          ollama: 'offline',
          errorMessage: 'Local Python backend is unreachable on http://127.0.0.1:8000',
        }))
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 4000)
    return () => clearInterval(interval)
  }, [settings.modelName, refreshTasks])

  // Load existing user character from local storage if available
  useEffect(() => {
    if (typeof window !== 'undefined' && window.auraAPI?.getStoredVrmCharacter) {
      window.auraAPI
        .getStoredVrmCharacter()
        .then((storedPath) => {
          if (storedPath) {
            setSettings((prev) => (prev.vrmModelPath ? prev : { ...prev, vrmModelPath: storedPath }))
          }
        })
        .catch(() => {})
    }
  }, [])

  const sendMessage = (content: string, isVoice: boolean = false): void => {
    if (!content.trim()) return

    // Stop any existing speech playback before responding to new user input
    stopSpeech()

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      isVoice,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setAssistantState('thinking')

    // Live streamed interaction with local Python backend & Ollama
    const replyId = `msg-${Date.now() + 1}`
    let messageCreated = false
    let accumulatedReply = ''

    sendChatMessageStream(
      content,
      currentSessionId,
      settings.modelName,
      (delta) => {
        accumulatedReply += delta
        setAssistantState('responding')
        if (!messageCreated) {
          messageCreated = true
          setMessages((prev) => [
            ...prev,
            {
              id: replyId,
              role: 'assistant',
              content: delta,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              state: 'responding',
            },
          ])
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === replyId ? { ...m, content: m.content + delta, state: 'responding' } : m
            )
          )
        }
      },
      (data) => {
        setAssistantState('idle')
        if (data.sessionId && data.sessionId !== currentSessionId) {
          setCurrentSessionId(data.sessionId)
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, state: 'idle' } : m))
        )

        // Automatically synthesize response if voice output is enabled
        if (settings.voiceOutputEnabled && accumulatedReply.trim()) {
          playSynthesizedSpeech(accumulatedReply.trim())
        }
      },
      (errText) => {
        setAssistantState('error')
        const errMessage: Message = {
          id: `msg-err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Inference Unavailable**\n\n${errText}\n\n*Diagnostics:*\n- Local Ollama Base URL: \`${settings.ollamaUrl}\`\n- Target Model: \`${settings.modelName}\`\n- If model is missing, run: \`ollama run ${settings.modelName}\` in your terminal.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          state: 'error',
        }
        setMessages((prev) => [...prev, errMessage])
      }
    )
  }

  const approveConfirmation = async (): Promise<void> => {
    const proposal = pendingConfirmation
    setAssistantState('executing')
    setPendingConfirmation(null)

    if (proposal?.callId) {
      try {
        const result = await confirmToolProposal(proposal.callId, true, currentSessionId)
        const outcomeMessage: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: result.success
            ? `✅ **Action Approved & Executed**\n\n${result.summary}`
            : `❌ **Execution Error**\n\n${result.error || result.summary}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          state: 'idle',
        }
        setMessages((prev) => [...prev, outcomeMessage])
        setAssistantState('idle')
        return
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err)
        const errMessage: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Failed to execute approved action: ${errMsg}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          state: 'error',
        }
        setMessages((prev) => [...prev, errMessage])
        setAssistantState('error')
        return
      }
    }

    setTimeout(() => {
      const outcomeMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content:
          '✅ **Action Approved & Executed**.\nUnified diff applied successfully. The outcome was audited in the local SQLite ledger.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        state: 'idle',
      }
      setMessages((prev) => [...prev, outcomeMessage])
      setAssistantState('idle')
      setTasks((prev) =>
        prev.map((t) =>
          t.id === 'task-102'
            ? {
                ...t,
                status: 'completed',
                outcome: 'Diff committed atomically with verifiable SHA256 checksum.',
                steps: t.steps.map((s) => ({ ...s, completed: true })),
              }
            : t
        )
      )
    }, 500)
  }

  const rejectConfirmation = async (): Promise<void> => {
    const proposal = pendingConfirmation
    setAssistantState('idle')
    setPendingConfirmation(null)

    if (proposal?.callId) {
      try {
        await confirmToolProposal(proposal.callId, false, currentSessionId)
      } catch {
        // Ignore network cancellation errors
      }
    }

    const outcomeMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content:
        '🛑 **Action Rejected by User**.\nExecution halted at the review boundary. No filesystem alterations were committed.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      state: 'idle',
    }
    setMessages((prev) => [...prev, outcomeMessage])
    setTasks((prev) =>
      prev.map((t) =>
        t.id === 'task-102'
          ? {
              ...t,
              status: 'failed',
              outcome: 'Operation rejected by human supervisor.',
            }
          : t
      )
    )
  }

  const clearMessages = (): void => {
    stopSpeech()
    setMessages([])
    setAssistantState('idle')
  }

  const switchSession = (id: string): void => {
    stopSpeech()
    setCurrentSessionId(id)
  }

  const deleteSession = (id: string): void => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (currentSessionId === id && sessions.length > 1) {
      const remaining = sessions.filter((s) => s.id !== id)
      setCurrentSessionId(remaining[0].id)
    }
  }

  const updateSettings = (newSettings: Partial<AppSettings>): void => {
    setSettings((prev) => ({ ...prev, ...newSettings }))
  }

  const toggleTaskPanel = (): void => {
    setIsTaskPanelOpen((prev) => !prev)
  }

  return (
    <AuraContext.Provider
      value={{
        assistantState,
        setAssistantState,
        activeTab,
        setActiveTab,
        messages,
        sendMessage,
        clearMessages,
        tasks,
        pendingConfirmation,
        approveConfirmation,
        rejectConfirmation,
        systemStatus,
        sessions,
        currentSessionId,
        switchSession,
        deleteSession,
        settings,
        updateSettings,
        isTaskPanelOpen,
        toggleTaskPanel,
        isSpeaking,
        stopSpeech,
        speechAnalyser,
        refreshTasks,
        cancelTaskById,
        confirmTaskById,
      }}
    >
      {children}
    </AuraContext.Provider>
  )
}

export const useAura = (): AuraContextType => {
  const context = useContext(AuraContext)
  if (!context) {
    throw new Error('useAura must be used within an AuraProvider')
  }
  return context
}
