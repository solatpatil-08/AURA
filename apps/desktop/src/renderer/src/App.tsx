import React from 'react'
import { AuraProvider } from './context/AuraContext'
import { AppShell } from './components/shell/AppShell'

export const App: React.FC = () => {
  return (
    <AuraProvider>
      <AppShell />
    </AuraProvider>
  )
}

export default App
