import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import './styles/app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

createRoot(root).render(
  <StrictMode>
    {/* Hash routing so the app works from a file server, a subpath or an
        installed PWA without any server-side rewrite rules. */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // Resolved against the page, so the app works from any sub-path.
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // A blocked service worker only costs offline caching; the app still runs
      // from IndexedDB, so this is not worth surfacing to the user.
    })
  })
}
