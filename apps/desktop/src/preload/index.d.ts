import { IAuraDesktopBridge } from './index'

declare global {
  interface Window {
    auraAPI: IAuraDesktopBridge
  }
}
