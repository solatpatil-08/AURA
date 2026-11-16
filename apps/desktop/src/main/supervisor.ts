import { spawn, spawnSync, ChildProcess } from 'child_process'
import http from 'http'
import path from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'

export interface SupervisorStatus {
  isAlive: boolean
  port: number
  startupAttempted: boolean
  startupFailed: boolean
  error: string | null
}

export interface BackendProcessSupervisor {
  start: () => Promise<void>
  stop: () => void
  isAlive: () => boolean
  getStatus: () => SupervisorStatus
}

let backendProcess: ChildProcess | null = null
let lastSupervisorError: string | null = null
let supervisorStartupAttempted = false
let supervisorStartupFailed = false

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
 * Resolve the best candidate Python executable for starting the local backend
 */
function resolvePythonExecutable(backendDir: string, isPackaged: boolean): { exe: string; isModule: boolean } | null {
  if (isPackaged) {
    const packagedBin = process.platform === 'win32'
      ? path.join(backendDir, 'aura_agent.exe')
      : path.join(backendDir, 'aura_agent')
    if (existsSync(packagedBin)) {
      return { exe: packagedBin, isModule: false }
    }
  }

  // Look for project virtual environment
  const candidates = process.platform === 'win32'
    ? [
        path.join(backendDir, '.venv', 'Scripts', 'python.exe'),
        path.resolve(process.cwd(), 'services/agent/.venv/Scripts/python.exe'),
        path.resolve(process.cwd(), '../services/agent/.venv/Scripts/python.exe'),
        path.resolve(process.cwd(), '.venv/Scripts/python.exe'),
        'python',
        'py'
      ]
    : [
        path.join(backendDir, '.venv', 'bin', 'python'),
        path.resolve(process.cwd(), 'services/agent/.venv/bin/python'),
        path.resolve(process.cwd(), '../services/agent/.venv/bin/python'),
        path.resolve(process.cwd(), '.venv/bin/python'),
        'python3',
        'python'
      ]

  for (const c of candidates) {
    if (c === 'python' || c === 'py' || c === 'python3') {
      return { exe: c, isModule: true }
    }
    if (existsSync(c)) {
      return { exe: c, isModule: true }
    }
  }

  return null
}

/**
 * Supervise the local Python backend lifecycle.
 */
export function createBackendSupervisor(port: number = 8000): BackendProcessSupervisor {
  return {
    async start(): Promise<void> {
      supervisorStartupAttempted = true
      supervisorStartupFailed = false
      lastSupervisorError = null

      const isAlreadyRunning = await checkBackendHealth(port)
      if (isAlreadyRunning) {
        console.log(`[Backend Supervisor] Backend service is already active on http://127.0.0.1:${port}`)
        return
      }

      const isPackaged = app.isPackaged
      const backendDir = isPackaged
        ? path.join(process.resourcesPath, 'agent')
        : path.resolve(__dirname, '../../../../services/agent')

      const pythonTarget = resolvePythonExecutable(backendDir, isPackaged)
      if (!pythonTarget) {
        lastSupervisorError = `No Python virtual environment (.venv) or python executable found in ${backendDir}. Ensure Python 3.10+ and dependencies are installed.`
        supervisorStartupFailed = true
        console.warn(`[Backend Supervisor] ${lastSupervisorError}`)
        return
      }

      console.log(`[Backend Supervisor] Launching backend service using: ${pythonTarget.exe} in ${backendDir}`)

      try {
        let spawnArgs: string[] = []
        if (pythonTarget.isModule) {
          spawnArgs = ['-m', 'uvicorn', 'aura_agent.main:app', '--host', '127.0.0.1', '--port', port.toString()]
        }

        backendProcess = spawn(
          pythonTarget.exe,
          spawnArgs,
          {
            cwd: backendDir,
            env: {
              ...process.env,
              PYTHONUNBUFFERED: '1',
              AURA_PORT: port.toString()
            },
            stdio: ['ignore', 'pipe', 'pipe']
          }
        )

        let initialStderr = ''
        backendProcess.stderr?.on('data', (data) => {
          const text = data.toString()
          initialStderr += text
          if (initialStderr.length > 1000) {
            initialStderr = initialStderr.slice(-1000)
          }
          console.error(`[AURA Backend Error] ${text.trim()}`)
        })

        backendProcess.stdout?.on('data', (data) => {
          console.log(`[AURA Backend] ${data.toString().trim()}`)
        })

        backendProcess.on('exit', (code, signal) => {
          console.log(`[Backend Supervisor] Backend process exited with code ${code}, signal ${signal}`)
          if (code !== 0 && code !== null) {
            supervisorStartupFailed = true
            lastSupervisorError = initialStderr.trim() || `Backend process terminated with exit code ${code}`
          }
          backendProcess = null
        })

        backendProcess.on('error', (err) => {
          supervisorStartupFailed = true
          lastSupervisorError = `Backend spawn error: ${err.message}`
          console.warn(`[Backend Supervisor] ${lastSupervisorError}`)
        })

        // Poll for healthy status over 6 seconds
        const startTime = Date.now()
        while (Date.now() - startTime < 6000) {
          await new Promise((r) => setTimeout(r, 600))
          if (await checkBackendHealth(port)) {
            console.log(`[Backend Supervisor] Backend verified healthy on http://127.0.0.1:${port}`)
            lastSupervisorError = null
            supervisorStartupFailed = false
            return
          }
        }

        if (!backendProcess || backendProcess.killed) {
          supervisorStartupFailed = true
          if (!lastSupervisorError) {
            lastSupervisorError = 'Backend failed to start. Review terminal logs.'
          }
        }
      } catch (err) {
        supervisorStartupFailed = true
        lastSupervisorError = err instanceof Error ? err.message : String(err)
        console.warn(`[Backend Supervisor] Launch failed:`, err)
      }
    },

    stop(): void {
      if (backendProcess && !backendProcess.killed) {
        console.log('[Backend Supervisor] Terminating backend child process...')
        try {
          if (process.platform === 'win32' && backendProcess.pid) {
            // Synchronous taskkill ensures process tree is killed immediately on Windows
            spawnSync('taskkill', ['/pid', backendProcess.pid.toString(), '/T', '/F'])
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

    getStatus(): SupervisorStatus {
      return {
        isAlive: backendProcess !== null && !backendProcess.killed,
        port,
        startupAttempted: supervisorStartupAttempted,
        startupFailed: supervisorStartupFailed,
        error: lastSupervisorError
      }
    }
  }
}
