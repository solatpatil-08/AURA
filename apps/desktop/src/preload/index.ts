import { contextBridge, ipcRenderer } from 'electron'

// Define the narrow, validated API contract
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
  selectVrmFile: () => Promise<string | null>
  saveVrmCharacter: (sourcePath: string) => Promise<string>
  getStoredVrmCharacter: () => Promise<string | null>
  resetVrmCharacter: () => Promise<void>
  loadVrmBinary: (filePath: string) => Promise<ArrayBuffer>
  getGpuDiagnostics: () => Promise<{
    hardwareAccelerationEnabled: boolean
    featureStatus: Record<string, unknown>
    gpuInfo?: Record<string, unknown>
  }>
  getAppSettings: () => Promise<Record<string, unknown> | null>
  saveAppSettings: (settings: Record<string, unknown>) => Promise<boolean>
}

const auraAPI: IAuraDesktopBridge = {
  minimize: (): void => {
    ipcRenderer.send('window:minimize')
  },
  maximize: (): void => {
    ipcRenderer.send('window:maximize')
  },
  close: (): void => {
    ipcRenderer.send('window:close')
  },
  getSystemStatus: async () => {
    return ipcRenderer.invoke('system:get-status')
  },
  selectVrmFile: async () => {
    return ipcRenderer.invoke('vrm:select-file')
  },
  saveVrmCharacter: async (sourcePath: string) => {
    return ipcRenderer.invoke('vrm:save-character', sourcePath)
  },
  getStoredVrmCharacter: async () => {
    return ipcRenderer.invoke('vrm:get-stored-character')
  },
  resetVrmCharacter: async () => {
    return ipcRenderer.invoke('vrm:reset-character')
  },
  loadVrmBinary: async (filePath: string) => {
    return ipcRenderer.invoke('vrm:load-binary', filePath)
  },
  getGpuDiagnostics: async () => {
    return ipcRenderer.invoke('system:get-gpu-diagnostics')
  },
  getAppSettings: async () => {
    return ipcRenderer.invoke('settings:get')
  },
  saveAppSettings: async (settings: Record<string, unknown>) => {
    return ipcRenderer.invoke('settings:save', settings)
  }
}

// Safely expose in main world via contextIsolation
try {
  contextBridge.exposeInMainWorld('auraAPI', auraAPI)
} catch (error) {
  console.error('[Preload] Failed to expose auraAPI:', error)
}
