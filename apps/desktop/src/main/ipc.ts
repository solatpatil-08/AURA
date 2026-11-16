import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import http from 'http'
import { BackendProcessSupervisor, checkBackendHealth } from './supervisor'

export interface SystemStatusResponse {
  ollama: 'connected' | 'offline' | 'checking'
  backend: 'ready' | 'starting' | 'stopped'
  activeModel: string
  modelInstalled?: boolean
  errorMessage?: string | null
  memoryMb: number
  micReady: boolean
}

export interface GpuDiagnosticsResponse {
  hardwareAccelerationEnabled: boolean
  featureStatus: Record<string, unknown>
  gpuInfo?: Record<string, unknown>
}

/**
 * Check Ollama connection and list installed tags
 */
function checkOllamaTags(baseUrl: string = 'http://127.0.0.1:11434'): Promise<{ connected: boolean; models: string[] }> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL('/api/tags', baseUrl)
      const req = http.get(
        {
          host: parsed.hostname || '127.0.0.1',
          port: parsed.port || 11434,
          path: parsed.pathname,
          timeout: 1800
        },
        (res) => {
          if (res.statusCode !== 200) {
            resolve({ connected: false, models: [] })
            return
          }
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            try {
              const json = JSON.parse(data)
              const models: string[] = (json.models || []).map((m: any) => m.name || m.model || '')
              resolve({ connected: true, models })
            } catch {
              resolve({ connected: true, models: [] })
            }
          })
        }
      )
      req.on('error', () => resolve({ connected: false, models: [] }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ connected: false, models: [] })
      })
    } catch {
      resolve({ connected: false, models: [] })
    }
  })
}

/**
 * Register validated IPC listeners for the renderer process.
 * Strict channel allowlist with input validation.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow, supervisor?: BackendProcessSupervisor): void {
  // Window controls
  ipcMain.on('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize()
    }
  })

  ipcMain.on('window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
    }
  })

  ipcMain.on('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  })

  // System status query verifying real local backend & Ollama connectivity
  ipcMain.handle('system:get-status', async (): Promise<SystemStatusResponse> => {
    const memoryUsage = process.memoryUsage()
    const memoryMb = Math.round(memoryUsage.heapUsed / 1024 / 1024)

    // 1. Check Python Backend Health
    let backendState: 'ready' | 'starting' | 'stopped' = 'stopped'
    const isBackendHealthy = await checkBackendHealth(8000)

    if (isBackendHealthy) {
      backendState = 'ready'
    } else if (supervisor && supervisor.isAlive()) {
      backendState = 'starting'
    } else {
      backendState = 'stopped'
    }

    const supStatus = supervisor ? supervisor.getStatus() : null

    // 2. Check Ollama Connectivity & Model Availability
    let ollamaState: 'connected' | 'offline' | 'checking' = 'offline'
    let modelInstalled = false
    let ollamaError: string | null = null

    // Read configured model from persistent settings if available
    let configuredModel = 'qwen3.5:4b'
    let ollamaUrl = 'http://127.0.0.1:11434'
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')
    if (existsSync(settingsPath)) {
      try {
        const raw = await fs.readFile(settingsPath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed.modelName) configuredModel = parsed.modelName
        if (parsed.ollamaUrl) ollamaUrl = parsed.ollamaUrl
      } catch {
        // Fall back to defaults
      }
    }

    try {
      const ollamaCheck = await checkOllamaTags(ollamaUrl)
      if (ollamaCheck.connected) {
        ollamaState = 'connected'
        const installed = ollamaCheck.models
        const normTarget = configuredModel.toLowerCase().trim()
        modelInstalled = installed.some((m) => {
          const nm = m.toLowerCase().trim()
          return nm === normTarget || nm.startsWith(`${normTarget}:`) || normTarget.startsWith(`${nm}:`) || nm.split(':')[0] === normTarget.split(':')[0]
        })
        if (!modelInstalled) {
          ollamaError = `Model '${configuredModel}' is not installed in local Ollama. Run: 'ollama pull ${configuredModel}'`
        }
      } else {
        ollamaState = 'offline'
        ollamaError = `Ollama service is unreachable on ${ollamaUrl}. Ensure Ollama is running locally.`
      }
    } catch {
      ollamaState = 'offline'
      ollamaError = 'Failed to connect to local Ollama service.'
    }

    let finalError: string | null = null
    if (backendState === 'stopped') {
      finalError = supStatus?.error || 'Local Python backend is stopped on http://127.0.0.1:8000'
    } else if (ollamaState === 'offline') {
      finalError = ollamaError
    } else if (!modelInstalled) {
      finalError = ollamaError
    }

    return {
      ollama: ollamaState,
      backend: backendState,
      activeModel: configuredModel,
      modelInstalled,
      errorMessage: finalError,
      memoryMb,
      micReady: true
    }
  })

  // Persistent settings storage in designated user-data directory
  ipcMain.handle('settings:get', async (): Promise<Record<string, unknown> | null> => {
    const settingsFile = path.join(app.getPath('userData'), 'settings.json')
    if (!existsSync(settingsFile)) return null
    try {
      const data = await fs.readFile(settingsFile, 'utf8')
      return JSON.parse(data)
    } catch (e) {
      console.warn('[IPC] Failed to read settings.json:', e)
      return null
    }
  })

  ipcMain.handle('settings:save', async (_event, newSettings: Record<string, unknown>): Promise<boolean> => {
    if (!newSettings || typeof newSettings !== 'object') {
      throw new Error('Invalid settings object provided')
    }
    const settingsFile = path.join(app.getPath('userData'), 'settings.json')
    try {
      await fs.writeFile(settingsFile, JSON.stringify(newSettings, null, 2), 'utf8')
      return true
    } catch (e) {
      console.error('[IPC] Failed to write settings.json:', e)
      return false
    }
  })

  // Safe GPU diagnostics collection for WebGL & graphics debugging
  ipcMain.handle('system:get-gpu-diagnostics', async (): Promise<GpuDiagnosticsResponse> => {
    const featureStatus = app.getGPUFeatureStatus()
    const hwDisabled = app.commandLine.hasSwitch('disable-gpu') || featureStatus.gpu_compositing === 'disabled'
    let gpuInfo: Record<string, unknown> | undefined = undefined
    try {
      gpuInfo = (await app.getGPUInfo('complete')) as Record<string, unknown>
    } catch {
      try {
        gpuInfo = (await app.getGPUInfo('basic')) as Record<string, unknown>
      } catch {
        // Ignore if query fails or is unsupported
      }
    }

    return {
      hardwareAccelerationEnabled: !hwDisabled,
      featureStatus: featureStatus as unknown as Record<string, unknown>,
      gpuInfo
    }
  })

  // Local VRM file selection dialog
  ipcMain.handle('vrm:select-file', async (): Promise<string | null> => {
    if (!mainWindow || mainWindow.isDestroyed()) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Local VRM Character Model',
      filters: [{ name: 'VRM Character Models (*.vrm)', extensions: ['vrm'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Safe local VRM binary reading
  ipcMain.handle('vrm:load-binary', async (_event, filePath: string): Promise<ArrayBuffer> => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path provided')
    }
    let cleanPath = filePath.trim().replace(/^file:\/\/\/?/, '')
    try {
      cleanPath = decodeURIComponent(cleanPath)
    } catch {
      // Ignore URI decode errors
    }
    let resolved = path.resolve(cleanPath)
    if (!resolved.toLowerCase().endsWith('.vrm')) {
      throw new Error('Character model must have a .vrm extension')
    }
    if (!existsSync(resolved)) {
      // Check relative to cwd / workspace
      const fromCwd = path.resolve(process.cwd(), cleanPath)
      if (existsSync(fromCwd)) {
        resolved = fromCwd
      } else {
        throw new Error(`VRM file does not exist: ${resolved}`)
      }
    }
    const stat = await fs.stat(resolved)
    const MAX_VRM_BYTES = 200 * 1024 * 1024 // 200 MB maximum
    if (stat.size > MAX_VRM_BYTES) {
      throw new Error(`VRM model exceeds size limit (File: ${Math.round(stat.size / 1024 / 1024)}MB, Limit: 200MB)`)
    }
    const fileBuffer = await fs.readFile(resolved)
    return fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength)
  })

  // Store selected character model into designated user-data directory
  ipcMain.handle('vrm:save-character', async (_event, sourcePath: string): Promise<string> => {
    if (!sourcePath || typeof sourcePath !== 'string') {
      throw new Error('Invalid source file path provided')
    }
    let cleanSource = sourcePath.trim().replace(/^file:\/\/\/?/, '')
    try {
      cleanSource = decodeURIComponent(cleanSource)
    } catch {
      // Ignore
    }
    let resolvedSource = path.resolve(cleanSource)
    if (!existsSync(resolvedSource)) {
      const fromCwd = path.resolve(process.cwd(), cleanSource)
      if (existsSync(fromCwd)) {
        resolvedSource = fromCwd
      } else {
        throw new Error(`Source VRM file not found: ${resolvedSource}`)
      }
    }

    const userDataDir = app.getPath('userData')
    const targetDir = path.join(userDataDir, 'characters')
    await fs.mkdir(targetDir, { recursive: true })

    const safeBaseName = path.basename(resolvedSource).replace(/[^a-zA-Z0-9._-]/g, '_')
    const destPath = path.join(targetDir, safeBaseName)

    if (path.resolve(destPath) !== resolvedSource) {
      await fs.copyFile(resolvedSource, destPath)
    }

    return destPath
  })

  // Retrieve existing stored character from local user-data directory or project workspace
  ipcMain.handle('vrm:get-stored-character', async (): Promise<string | null> => {
    const userDataDir = app.getPath('userData')
    const targetDir = path.join(userDataDir, 'characters')

    // 1. Check user-data directory first
    if (existsSync(targetDir)) {
      try {
        const files = await fs.readdir(targetDir)
        const vrmFiles = files.filter((f) => f.toLowerCase().endsWith('.vrm'))
        if (vrmFiles.length > 0) {
          return path.join(targetDir, vrmFiles[0])
        }
      } catch {
        // Fall through
      }
    }

    // 2. Check local workspace & bundled directories for aura.vrm
    const candidatePaths = [
      path.resolve(process.cwd(), 'models/vrm/aura.vrm'),
      path.resolve(process.cwd(), '../models/vrm/aura.vrm'),
      path.resolve(process.cwd(), '../../models/vrm/aura.vrm'),
      path.resolve(app.getAppPath(), 'models/vrm/aura.vrm'),
      path.resolve(app.getAppPath(), '../models/vrm/aura.vrm'),
      path.resolve(app.getAppPath(), '../../models/vrm/aura.vrm'),
      path.resolve(process.resourcesPath || '', 'models/vrm/aura.vrm'),
      'C:\\Projects\\AURA\\models\\vrm\\aura.vrm'
    ]

    for (const candidate of candidatePaths) {
      if (candidate && existsSync(candidate)) {
        try {
          await fs.mkdir(targetDir, { recursive: true })
          const dest = path.join(targetDir, 'aura.vrm')
          if (!existsSync(dest)) {
            await fs.copyFile(candidate, dest)
          }
          return dest
        } catch {
          return candidate
        }
      }
    }

    return null
  })

  // Reset character selection back to procedural fallback
  ipcMain.handle('vrm:reset-character', async (): Promise<void> => {
    const userDataDir = app.getPath('userData')
    const targetDir = path.join(userDataDir, 'characters')
    if (existsSync(targetDir)) {
      try {
        const files = await fs.readdir(targetDir)
        for (const file of files) {
          if (file.toLowerCase().endsWith('.vrm')) {
            await fs.unlink(path.join(targetDir, file)).catch(() => {})
          }
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  })
}
