import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { patchWebGLPrototypesSafely } from './components/avatar/CharacterController'

// Initialize safe WebGL context interception before any DOM canvas or Three.js modules instantiate
patchWebGLPrototypesSafely()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

