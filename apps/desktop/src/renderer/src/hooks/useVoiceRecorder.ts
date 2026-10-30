import { useState, useRef, useEffect, useCallback } from 'react'
import { transcribeAudio } from '../services/api'

export interface VoiceRecorderState {
  isRecording: boolean
  isTranscribing: boolean
  recordingDuration: number
  permissionError: string | null
  startRecording: () => Promise<boolean>
  stopAndTranscribe: () => Promise<string | null>
  cancelRecording: () => void
}

export function useVoiceRecorder(): VoiceRecorderState {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  const startRecording = useCallback(async (): Promise<boolean> => {
    setPermissionError(null)

    // Verify browser mediaDevices support
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

      timerRef.current = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1)
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
      return false
    }
  }, [])

  const stopAndTranscribe = useCallback(async (): Promise<string | null> => {
    if (!mediaRecorderRef.current || !isRecording) {
      return null
    }

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

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

        if (audioBlob.size < 100) {
          setIsTranscribing(false)
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
  }, [isRecording])

  const cancelRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

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
  }, [])

  return {
    isRecording,
    isTranscribing,
    recordingDuration,
    permissionError,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  }
}
