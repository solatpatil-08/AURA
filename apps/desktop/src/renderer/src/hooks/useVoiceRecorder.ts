import { useState, useRef, useEffect, useCallback } from 'react'
import { transcribeAudio } from '../services/api'

export interface UseVoiceRecorderOptions {
  deviceId?: string
  language?: string
  vadEnabled?: boolean
  silenceTimeoutMs?: number
  voiceThresholdRms?: number
  onSpeechStart?: () => void
  onAutoTurnComplete?: (transcript: string) => void
}

export interface VoiceRecorderState {
  isRecording: boolean
  isTranscribing: boolean
  isSpeechActive: boolean
  rmsLevel: number
  recordingDuration: number
  maxDuration: number
  audioLevels: number[]
  permissionError: string | null
  startRecording: (overrideOptions?: { deviceId?: string }) => Promise<boolean>
  stopAndTranscribe: () => Promise<string | null>
  cancelRecording: () => void
}

const MAX_RECORDING_SECONDS = 60
const NUM_WAVEFORM_BARS = 16
const DEFAULT_SILENCE_TIMEOUT_MS = 1400
const DEFAULT_VOICE_THRESHOLD_RMS = 0.030

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}): VoiceRecorderState {
  const {
    deviceId,
    language,
    vadEnabled = false,
    silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
    voiceThresholdRms = DEFAULT_VOICE_THRESHOLD_RMS,
    onSpeechStart,
    onAutoTurnComplete,
  } = options

  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isSpeechActive, setIsSpeechActive] = useState(false)
  const [rmsLevel, setRmsLevel] = useState(0)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(NUM_WAVEFORM_BARS).fill(0.05))
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const stopAndTranscribeRef = useRef<() => Promise<string | null>>(async () => null)

  // VAD tracking refs
  const hasSpokenRef = useRef(false)
  const speechFramesCountRef = useRef(0)
  const lastSpeechTimeRef = useRef<number>(0)
  const silenceTimerRef = useRef<number | null>(null)
  const isStoppingRef = useRef(false)

  // Stored callbacks in refs to avoid stale closures in requestAnimationFrame loop
  const onSpeechStartRef = useRef(onSpeechStart)
  onSpeechStartRef.current = onSpeechStart
  const onAutoTurnCompleteRef = useRef(onAutoTurnComplete)
  onAutoTurnCompleteRef.current = onAutoTurnComplete
  const languageRef = useRef(language)
  languageRef.current = language
  const vadEnabledRef = useRef(vadEnabled)
  vadEnabledRef.current = vadEnabled
  const silenceTimeoutMsRef = useRef(silenceTimeoutMs)
  silenceTimeoutMsRef.current = silenceTimeoutMs
  const voiceThresholdRmsRef = useRef(voiceThresholdRms)
  voiceThresholdRmsRef.current = voiceThresholdRms

  const cleanupAudioNodes = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
    setAudioLevels(new Array(NUM_WAVEFORM_BARS).fill(0.05))
    setRmsLevel(0)
    setIsSpeechActive(false)
    hasSpokenRef.current = false
    speechFramesCountRef.current = 0
  }, [])

  // Clear timer and streams on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      cleanupAudioNodes()
    }
  }, [cleanupAudioNodes])

  // Stop & Transcribe callback
  const stopAndTranscribe = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current || !isRecording || isStoppingRef.current) {
      return null
    }

    isStoppingRef.current = true

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    cleanupAudioNodes()
    setIsRecording(false)
    setIsTranscribing(true)

    return new Promise<string | null>((resolve) => {
      const recorder = mediaRecorderRef.current!

      recorder.onstop = async () => {
        // Stop all hardware tracks immediately
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop())
          mediaStreamRef.current = null
        }

        const mimeType = recorder.mimeType || 'audio/webm'
        const audioBlob = new Blob(chunksRef.current, { type: mimeType })
        chunksRef.current = []
        isStoppingRef.current = false

        // Guard minimum and maximum file constraints
        if (audioBlob.size < 100) {
          setIsTranscribing(false)
          resolve(null)
          return
        }

        if (audioBlob.size > 15 * 1024 * 1024) {
          setIsTranscribing(false)
          setPermissionError('Audio recording exceeds 15 MB payload limit.')
          resolve(null)
          return
        }

        try {
          const result = await transcribeAudio(audioBlob, 'recording.webm', languageRef.current)
          setIsTranscribing(false)
          const transcript = result.text.trim() || null
          if (transcript && onAutoTurnCompleteRef.current) {
            onAutoTurnCompleteRef.current(transcript)
          }
          resolve(transcript)
        } catch (err: unknown) {
          setIsTranscribing(false)
          const errorMsg = err instanceof Error ? err.message : 'Transcription error'
          setPermissionError(errorMsg)
          resolve(null)
        }
      }

      try {
        recorder.stop()
      } catch {
        isStoppingRef.current = false
        setIsTranscribing(false)
        resolve(null)
      }
    })
  }, [isRecording, cleanupAudioNodes])

  stopAndTranscribeRef.current = stopAndTranscribe

  // Real-time audio waveform and Voice Activity Detection loop using Web Audio API
  const startAudioAnalysis = useCallback((stream: MediaStream) => {
    try {
      if (typeof window === 'undefined') return
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx || typeof AudioCtx !== 'function') return
      const ctx = new AudioCtx()
      audioContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)
      analyserRef.current = analyser

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const timeData = new Uint8Array(analyser.fftSize)

      const updateAnalysis = () => {
        if (!analyserRef.current) return

        // 1. Frequency spectrum for waveform bars
        analyserRef.current.getByteFrequencyData(freqData)
        const step = Math.floor(freqData.length / NUM_WAVEFORM_BARS) || 1
        const levels: number[] = []
        for (let i = 0; i < NUM_WAVEFORM_BARS; i++) {
          const val = freqData[i * step] || 0
          const normalized = Math.max(0.08, Math.min(1.0, val / 255.0))
          levels.push(normalized)
        }
        setAudioLevels(levels)

        // 2. Time-domain RMS Energy for real-time VAD
        analyserRef.current.getByteTimeDomainData(timeData)
        let sumSquares = 0
        for (let i = 0; i < timeData.length; i++) {
          const normalized = (timeData[i] - 128) / 128.0
          sumSquares += normalized * normalized
        }
        const rms = Math.sqrt(sumSquares / timeData.length)
        setRmsLevel(Math.min(1.0, Math.round(rms * 1000) / 1000))

        const isVoice = rms >= voiceThresholdRmsRef.current

        if (isVoice) {
          speechFramesCountRef.current++
          if (speechFramesCountRef.current >= 3) {
            if (!hasSpokenRef.current) {
              hasSpokenRef.current = true
              setIsSpeechActive(true)
              if (onSpeechStartRef.current) {
                onSpeechStartRef.current()
              }
            } else {
              setIsSpeechActive(true)
            }
            lastSpeechTimeRef.current = performance.now()
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current)
              silenceTimerRef.current = null
            }
          }
        } else {
          speechFramesCountRef.current = 0
          setIsSpeechActive(false)

          // 3. Automatic End-of-Speech (EOS) Turn Detection
          if (vadEnabledRef.current && hasSpokenRef.current && !isStoppingRef.current) {
            const silenceElapsed = performance.now() - lastSpeechTimeRef.current
            if (silenceElapsed >= silenceTimeoutMsRef.current) {
              hasSpokenRef.current = false
              setTimeout(() => {
                stopAndTranscribeRef.current()
              }, 0)
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(updateAnalysis)
      }

      updateAnalysis()
    } catch (err) {
      console.warn('Web Audio Analyser not supported or failed to initialize:', err)
    }
  }, [])

  const startRecording = useCallback(
    async (overrideOptions?: { deviceId?: string }): Promise<boolean> => {
      setPermissionError(null)

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionError('Audio recording is not supported in this environment.')
        return false
      }

      try {
        const targetDeviceId = overrideOptions?.deviceId || deviceId
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }

        if (targetDeviceId && targetDeviceId !== 'default') {
          audioConstraints.deviceId = { exact: targetDeviceId }
        }

        // 1. Request microphone permission strictly upon explicit user interaction
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        })

        mediaStreamRef.current = stream
        chunksRef.current = []
        hasSpokenRef.current = false
        speechFramesCountRef.current = 0
        lastSpeechTimeRef.current = performance.now()
        isStoppingRef.current = false

        // Pick supported mime type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'

        const recorder = new MediaRecorder(stream, { mimeType })
        mediaRecorderRef.current = recorder

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data)
          }
        }

        recorder.start(100) // 100ms slices
        setIsRecording(true)
        setRecordingDuration(0)

        // Start Web Audio API visual & VAD analysis
        startAudioAnalysis(stream)

        // Enforce 60-second max recording duration
        timerRef.current = window.setInterval(() => {
          setRecordingDuration((prev) => {
            const next = prev + 1
            if (next >= MAX_RECORDING_SECONDS) {
              // Reached maximum limit: stop recording and transcribe automatically
              setTimeout(() => {
                stopAndTranscribeRef.current()
              }, 0)
            }
            return next
          })
        }, 1000)

        return true
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string }
        let message = 'Unable to access microphone.'
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          message = 'Microphone permission was denied. Please allow microphone access in Windows Settings.'
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
          message = 'No microphone or audio input device found on this system.'
        }
        setPermissionError(message)
        setIsRecording(false)
        cleanupAudioNodes()
        return false
      }
    },
    [deviceId, cleanupAudioNodes, startAudioAnalysis]
  )

  const cancelRecording = useCallback(() => {
    isStoppingRef.current = true
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    cleanupAudioNodes()

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch {
        // Ignore stop errors on cancel
      }
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }

    chunksRef.current = []
    isStoppingRef.current = false
    setIsRecording(false)
    setIsTranscribing(false)
    setRecordingDuration(0)
  }, [cleanupAudioNodes])

  return {
    isRecording,
    isTranscribing,
    isSpeechActive,
    rmsLevel,
    recordingDuration,
    maxDuration: MAX_RECORDING_SECONDS,
    audioLevels,
    permissionError,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  }
}
