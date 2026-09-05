import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown in the message so the user knows which part failed. */
  area?: string
}

interface State {
  error: Error | null
}

/**
 * Stops one broken component taking the whole app down.
 *
 * Without this, any render-time throw unmounts the tree and leaves a white
 * screen — which on site reads as "the app crashed" with no way back and no
 * clue what happened. Records are in IndexedDB and unaffected, so the useful
 * thing is to say so and offer a way to carry on.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept for the browser console — there is no reporting endpoint by design,
    // since the app must work with no network.
    console.error('Render failed', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="card" style={{ margin: 12 }}>
        <div className="card__body">
          <h2 style={{ fontSize: 16 }}>
            Something went wrong{this.props.area ? ` in ${this.props.area}` : ''}
          </h2>
          <p className="small muted" style={{ marginTop: 6 }}>
            Your job, ITPs and photos are stored on this device and are unaffected. Try again, and if it keeps happening take
            a backup from Settings before clearing anything.
          </p>
          <details style={{ marginTop: 10 }}>
            <summary className="small" style={{ cursor: 'pointer' }}>
              Technical detail
            </summary>
            <pre
              className="small mono"
              style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', marginTop: 8, color: 'var(--ink-2)' }}
            >
              {error.message}
            </pre>
          </details>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
