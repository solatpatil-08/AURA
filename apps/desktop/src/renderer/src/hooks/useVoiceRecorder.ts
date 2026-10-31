import { useState, useRef, useEffect, useCallback } from 'react'
import { transcribeAudio } from '../services/api'

export interface VoiceRecorderState {
  isRecording: boolean
  isTranscribing: boolean
  recordingDuration: number
  maxDuration: number
  audioLevels: number[]
  permissionError: string | null
  startRecording: () => Promise<boolean>
  stopAndTranscribe: () => Promise<string | null>
  cancelRecording: () => void
}

const MAX_RECORDING_SECONDS = 60
const NUM_WAVEFORM_BARS = 16

export function useVoiceRecorder(): VoiceRecorderState {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
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

  const cleanupAudioNodes = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
    setAudioLevels(new Array(NUM_WAVEFORM_BARS).fill(0.05))
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
    if (!mediaRecorderRef.current || !isRecording) {
      return null
    }

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
          const result = await transcribeAudio(audioBlob, 'recording.webm')
          setIsTranscribing(false)
          resolve(result.text.trim() || null)
        } catch (err: unknown) {
          setIsTranscribing(false)
          const errorMsg = err instanceof Error ? err.message : 'Transcription error'
          setPermissionError(errorMsg)
          resolve(null)
        }
      }

      recorder.stop()
    })
  }, [isRecording, cleanupAudioNodes])

  stopAndTranscribeRef.current = stopAndTranscribe

  // Real-time audio waveform loop using Web Audio API AnalyserNode
  const startAudioAnalysis = useCallback((stream: MediaStream) => {
    try {
      if (typeof window === 'undefined') return
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx || typeof AudioCtx !== 'function') return
      const ctx = new AudioCtx()
      audioContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateBars = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)

        // Downsample frequency bins to NUM_WAVEFORM_BARS (16 bars)
        const step = Math.floor(dataArray.length / NUM_WAVEFORM_BARS) || 1
        const levels: number[] = []
        for (let i = 0; i < NUM_WAVEFORM_BARS; i++) {
          const val = dataArray[i * step] || 0
          // Normalize to [0.08, 1.0] with natural scaling
          const normalized = Math.max(0.08, Math.min(1.0, val / 255.0))
          levels.push(normalized)
        }
        setAudioLevels(levels)
        animationFrameRef.current = requestAnimationFrame(updateBars)
      }

      updateBars()
    } catch (err) {
      console.warn('Web Audio Analyser not supported or failed to initialize:', err)
    }
  }, [])

  const startRecording = useCallback(async (): Promise<boolean> => {
    setPermissionError(null)

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionError('Audio recording is not supported in this environment.')
      return false
    }

    try {
      // 1. Request microphone permission strictly upon explicit user interaction
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      mediaStreamRef.current = stream
      chunksRef.current = []

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

      // Start Web Audio API visual analysis
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
  }, [cleanupAudioNodes, startAudioAnalysis])

  const cancelRecording = useCallback(() => {
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
    setIsRecording(false)
    setIsTranscribing(false)
    setRecordingDuration(0)
  }, [cleanupAudioNodes])

  return {
    isRecording,
    isTranscribing,
    recordingDuration,
    maxDuration: MAX_RECORDING_SECONDS,
    audioLevels,
    permissionError,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  }
}
