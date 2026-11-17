import { Component, type ErrorInfo, type ReactNode } from 'react'

interface RouteErrorBoundaryProps {
  children: ReactNode
  resetKey?: string
  onBackToDashboard?: () => void
}

interface RouteErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RouteErrorBoundary]', error, info.componentStack)
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null })
    this.props.onBackToDashboard?.()
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    const msg = this.state.error?.message || 'An unexpected rendering error occurred.'
    const isChunkError = /dynamically imported module|loading chunk|failed to fetch/i.test(msg)

    return (
      <div className="pl-card" role="alert" style={{ maxWidth: 640, margin: '32px auto' }}>
        <div className="pl-error-box" style={{ marginBottom: 14 }}>
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />{' '}
          {isChunkError
            ? 'A newer version of this page is available. Reload to continue.'
            : 'Unable to render this page right now.'}
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', marginBottom: 16 }}>
          {msg}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="pl-btn pl-btn-primary"
            onClick={() => window.location.reload()}
          >
            <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Reload Page
          </button>
          <button
            type="button"
            className="pl-btn pl-btn-ghost"
            onClick={this.handleReset}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />{' '}
            {this.props.onBackToDashboard ? 'Back to Dashboard' : 'Reset View'}
          </button>
        </div>
      </div>
    )
  }
}

export default RouteErrorBoundary
