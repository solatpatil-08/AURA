import { spawn, ChildProcess } from 'child_process'
import http from 'http'
import path from 'path'
import { app } from 'electron'

export interface BackendProcessSupervisor {
  start: () => Promise<void>
  stop: () => void
  isAlive: () => boolean
}

let backendProcess: ChildProcess | null = null

/**
 * Check if the backend is responding on localhost
 */
export function checkBackendHealth(port: number = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/health',
        timeout: 1500,
      },
      (res) => {
        resolve(res.statusCode === 200)
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

/**
 * Supervise the local Python backend lifecycle.
 */
export function createBackendSupervisor(port: number = 8000): BackendProcessSupervisor {
  return {
    async start(): Promise<void> {
      const isAlreadyRunning = await checkBackendHealth(port)
      if (isAlreadyRunning) {
        console.log(`[Backend Supervisor] Backend service is already active on http://127.0.0.1:${port}`)
        return
      }

      // If in production packaged app, locate bundled backend sidecar
      const isPackaged = app.isPackaged
      const backendDir = isPackaged
        ? path.join(process.resourcesPath, 'agent')
        : path.resolve(__dirname, '../../../../services/agent')

      const pythonExe = process.platform === 'win32'
        ? (isPackaged ? path.join(backendDir, 'aura_agent.exe') : path.join(backendDir, '.venv', 'Scripts', 'python.exe'))
        : (isPackaged ? path.join(backendDir, 'aura_agent') : path.join(backendDir, '.venv', 'bin', 'python'))

      console.log(`[Backend Supervisor] Checking executable for backend launch: ${pythonExe}`)

      try {
        if (!isPackaged) {
          // Dev mode sidecar launch
          backendProcess = spawn(
            pythonExe,
            ['-m', 'uvicorn', 'aura_agent.main:app', '--host', '127.0.0.1', '--port', port.toString()],
            {
              cwd: backendDir,
              env: { ...process.env, PYTHONUNBUFFERED: '1' },
              stdio: ['ignore', 'pipe', 'pipe'],
            }
          )
        } else {
          // Packaged binary launch
          backendProcess = spawn(pythonExe, [], {
            cwd: backendDir,
            env: { ...process.env, AURA_PORT: port.toString() },
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        }

        backendProcess.stdout?.on('data', (data) => {
          console.log(`[AURA Backend] ${data.toString().trim()}`)
        })

        backendProcess.stderr?.on('data', (data) => {
          console.error(`[AURA Backend Error] ${data.toString().trim()}`)
        })

        backendProcess.on('exit', (code, signal) => {
          console.log(`[Backend Supervisor] Backend process exited with code ${code}, signal ${signal}`)
          backendProcess = null
        })

        backendProcess.on('error', (err) => {
          console.warn(`[Backend Supervisor] Note: Standalone backend not spawned directly: ${err.message}. Backend can run independently.`)
        })
      } catch (err) {
        console.warn(`[Backend Supervisor] Standalone backend launch bypassed:`, err)
      }
    },

    stop(): void {
      if (backendProcess && !backendProcess.killed) {
        console.log('[Backend Supervisor] Terminating backend child process...')
        try {
          if (process.platform === 'win32' && backendProcess.pid) {
            // Graceful taskkill for Windows process trees
            spawn('taskkill', ['/pid', backendProcess.pid.toString(), '/T', '/F'])
          } else {
            backendProcess.kill('SIGTERM')
          }
        } catch (err) {
          console.error('[Backend Supervisor] Error terminating backend process:', err)
        }
        backendProcess = null
      }
    },

    isAlive(): boolean {
      return backendProcess !== null && !backendProcess.killed
    },
  }
}
