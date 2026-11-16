export interface IAuraDesktopBridge {
  minimize: () => void
  maximize: () => void
  close: () => void
  getSystemStatus: () => Promise<{
    ollama: 'connected' | 'offline' | 'checking'
    backend: 'ready' | 'starting' | 'stopped'
    activeModel: string
    modelInstalled?: boolean
    errorMessage?: string | null
    memoryMb: number
    micReady: boolean
  }>
  selectVrmFile?: () => Promise<string | null>
  saveVrmCharacter?: (sourcePath: string) => Promise<string>
  getStoredVrmCharacter?: () => Promise<string | null>
  resetVrmCharacter?: () => Promise<void>
  loadVrmBinary?: (filePath: string) => Promise<ArrayBuffer>
  getGpuDiagnostics?: () => Promise<{
    hardwareAccelerationEnabled: boolean
    featureStatus: Record<string, unknown>
    gpuInfo?: Record<string, unknown>
  }>
  getAppSettings?: () => Promise<Record<string, unknown> | null>
  saveAppSettings?: (settings: Record<string, unknown>) => Promise<boolean>
}

declare global {
  interface Window {
    auraAPI?: IAuraDesktopBridge
  }
}
