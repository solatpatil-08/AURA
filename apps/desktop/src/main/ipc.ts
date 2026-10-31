import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import { promises as fs, existsSync } from 'fs'
import path from 'path'

export interface SystemStatusResponse {
  ollama: 'connected' | 'offline' | 'checking'
  backend: 'ready' | 'starting' | 'stopped'
  activeModel: string
  memoryMb: number
  micReady: boolean
}

/**
 * Register validated IPC listeners for the renderer process.
 * Strict channel allowlist with input validation.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
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

  // System status query (validated schema return)
  ipcMain.handle('system:get-status', async (): Promise<SystemStatusResponse> => {
    // In Phase 1 foundation, return structured local status
    const memoryUsage = process.memoryUsage()
    return {
      ollama: 'connected',
      backend: 'ready',
      activeModel: 'qwen3.5:4b',
      memoryMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      micReady: false // Explicitly standby per Phase 1 requirements
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
    const cleanPath = filePath.trim().replace(/^file:\/\/\/?/, '')
    const resolved = path.resolve(cleanPath)
    if (!resolved.toLowerCase().endsWith('.vrm')) {
      throw new Error('Character model must have a .vrm extension')
    }
    if (!existsSync(resolved)) {
      throw new Error(`VRM file does not exist: ${resolved}`)
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
    const cleanSource = sourcePath.trim().replace(/^file:\/\/\/?/, '')
    const resolvedSource = path.resolve(cleanSource)
    if (!existsSync(resolvedSource)) {
      throw new Error(`Source VRM file not found: ${resolvedSource}`)
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

  // Retrieve existing stored character from local user-data directory
  ipcMain.handle('vrm:get-stored-character', async (): Promise<string | null> => {
    const userDataDir = app.getPath('userData')
    const targetDir = path.join(userDataDir, 'characters')
    if (!existsSync(targetDir)) return null

    try {
      const files = await fs.readdir(targetDir)
      const vrmFiles = files.filter((f) => f.toLowerCase().endsWith('.vrm'))
      if (vrmFiles.length === 0) return null
      return path.join(targetDir, vrmFiles[0])
    } catch {
      return null
    }
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
