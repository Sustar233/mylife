import type { PropsWithChildren } from 'react'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { WorldProvider } from './state/world-context'
import './app.scss'

function App({ children }: PropsWithChildren) {
  return <AppErrorBoundary><WorldProvider>{children}</WorldProvider></AppErrorBoundary>
}

export default App
