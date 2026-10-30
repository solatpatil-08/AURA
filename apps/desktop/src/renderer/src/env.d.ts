export interface IAuraDesktopBridge {
  minimize: () => void
  maximize: () => void
  close: () => void
  getSystemStatus: () => Promise<{
    ollama: 'connected' | 'offline' | 'checking'
    backend: 'ready' | 'starting' | 'stopped'
    activeModel: string
    memoryMb: number
    micReady: boolean
  }>
  selectVrmFile?: () => Promise<string | null>
  loadVrmBinary?: (filePath: string) => Promise<ArrayBuffer>
}

declare global {
  interface Window {
    auraAPI?: IAuraDesktopBridge
  }
}
