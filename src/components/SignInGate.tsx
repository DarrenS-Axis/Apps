import { useState } from 'react'
import { signIn, syncNow } from '../sync'

/**
 * The organisation's app opens on its shared data, so the first thing on a
 * new device is signing in with the work account. After that the account is
 * remembered, and the app opens straight in — with signal or without.
 */
export function SignInGate({ siteUrl }: { siteUrl?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      await signIn()
      void syncNow()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in did not complete.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card" style={{ maxWidth: 520, margin: '40px auto 0' }}>
      <div className="card__body stack">
        <h2 style={{ margin: 0 }}>Sign in to Axis QA</h2>
        <p className="muted" style={{ margin: 0 }}>
          Everyone sees the same projects, ITPs, penetrations, defects and plant — live from the company&apos;s Microsoft 365. Sign in with your Axis work
          account to open it on this device. You stay signed in, and the app keeps working with no signal.
        </p>
        {siteUrl ? <p className="small muted" style={{ margin: 0 }}>Data: {siteUrl.replace(/^https:\/\//, '')}</p> : null}
        {!navigator.onLine ? <div className="banner banner--warn">This device is offline. Signing in needs signal the first time.</div> : null}
        {error ? <div className="banner banner--hold">{error}</div> : null}
        <button className="btn" type="button" disabled={busy} onClick={go}>
          {busy ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>
      </div>
    </div>
  )
}
