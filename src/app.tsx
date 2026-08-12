import type { PropsWithChildren } from 'react'
import { WorldProvider } from './state/world-context'
import './app.scss'

function App({ children }: PropsWithChildren) {
  return <WorldProvider>{children}</WorldProvider>
}

export default App
