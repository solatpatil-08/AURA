import { BrowserWindow, shell } from 'electron'

/**
 * Configure strict security boundaries on the BrowserWindow:
 * 1. Blocks arbitrary in-app navigation (will-navigate).
 * 2. Intercepts external links to open safely in the OS default browser.
 * 3. Prevents child window creation.
 */
export function setupSecurityHandlers(mainWindow: BrowserWindow): void {
  // Prevent any in-app navigation to untrusted URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    // Only allow local file navigation or local dev server navigation
    if (parsedUrl.origin !== 'http://localhost:5173' && parsedUrl.protocol !== 'file:') {
      event.preventDefault()
      console.warn(`[Security] Blocked unauthorized navigation attempt to: ${navigationUrl}`)
    }
  })

  // Prevent opening popups/new windows directly inside the Electron runtime
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http/https URLs to open in user's external default browser
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url).catch((err) => {
        console.error('[Security] Failed to open external URL:', err)
      })
    }
    return { action: 'deny' }
  })
}
