import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Tone from 'tone'
import './index.css'
import App from './App.tsx'
import { initGlobalLogger } from './utils/logger'

// Initialize comprehensive application logging & error interception
initGlobalLogger()

// Global safety monkey-patch for Tone.Param.prototype to guarantee
// undefined, null, or non-finite values never cause unhandled "Invalid argument(s) to setValueAtTime" crashes.
const origParamSetValueAtTime = Tone.Param.prototype.setValueAtTime
Tone.Param.prototype.setValueAtTime = function (value: any, time: any) {
  const safeTime = typeof time === 'number' && isFinite(time) ? time : 0
  let safeValue = value
  if (safeValue === undefined || safeValue === null || (typeof safeValue === 'number' && !isFinite(safeValue))) {
    const initial = (this as any)._initialValue
    safeValue = typeof initial === 'number' && isFinite(initial) ? initial : 0
  }
  return origParamSetValueAtTime.call(this, safeValue, safeTime)
}

const origParamRampTo = Tone.Param.prototype.rampTo
Tone.Param.prototype.rampTo = function (value: any, rampTime: any, startTime: any) {
  let safeVal = value
  if (safeVal === undefined || safeVal === null || (typeof safeVal === 'number' && !isFinite(safeVal))) {
    const initial = (this as any)._initialValue
    safeVal = typeof initial === 'number' && isFinite(initial) ? initial : 0
  }
  const safeRamp = typeof rampTime === 'number' && isFinite(rampTime) && rampTime > 0 ? rampTime : 0.05
  return origParamRampTo.call(this, safeVal, safeRamp, startTime)
}

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[React ErrorBoundary caught error]:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: '#ff6b6b', background: '#1a1b1e', fontFamily: 'monospace', height: '100vh', boxSizing: 'border-box' }}>
          <h2>Application Rendering Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ffa8a8', marginTop: 12 }}>
            {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{ marginTop: 16, padding: '8px 16px', background: '#339af0', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Reload Application
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
