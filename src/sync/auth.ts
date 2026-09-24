import type { SyncConfig } from '../data/types'

/**
 * Entra ID (Azure AD) sign-in through MSAL, loaded on demand: the library is
 * a few hundred kilobytes and a device that never syncs never needs it.
 *
 * The app is registered as a public client (single-page application) with
 * no secret — PKCE does the proving — so the only things to configure are
 * the tenant and the application (client) id, both safe to keep in Settings.
 */
export const GRAPH_SCOPES = ['User.Read', 'Sites.ReadWrite.All', 'Files.ReadWrite.All']

type Msal = typeof import('@azure/msal-browser')
let msalModule: Promise<Msal> | undefined
let app: import('@azure/msal-browser').PublicClientApplication | undefined
let appKey = ''

async function instance(config: SyncConfig) {
  if (!config.tenantId || !config.clientId) throw new Error('Enter the tenant id and application (client) id first.')
  const key = `${config.tenantId}|${config.clientId}`
  if (app && appKey === key) return app
  msalModule ??= import('@azure/msal-browser')
  const { PublicClientApplication } = await msalModule
  app = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      // Wherever the app is served from; the same URL must be on the registration.
      redirectUri: window.location.origin + window.location.pathname,
    },
    cache: { cacheLocation: 'localStorage' },
  })
  await app.initialize()
  // Finish a redirect-based sign-in if one is in flight (popups are blocked
  // on some phones, and iOS in particular).
  const result = await app.handleRedirectPromise()
  if (result?.account) app.setActiveAccount(result.account)
  appKey = key
  return app
}

export async function signIn(config: SyncConfig): Promise<{ name: string; username: string }> {
  const pca = await instance(config)
  try {
    const res = await pca.loginPopup({ scopes: GRAPH_SCOPES })
    pca.setActiveAccount(res.account)
    return { name: res.account.name ?? res.account.username, username: res.account.username }
  } catch (err) {
    // Popup blocked or unsupported: fall back to the full-page redirect, which
    // returns through handleRedirectPromise above.
    const code = (err as { errorCode?: string }).errorCode ?? ''
    if (/popup|user_cancelled|interaction_in_progress/i.test(code) && !/user_cancelled/.test(code)) {
      await pca.loginRedirect({ scopes: GRAPH_SCOPES })
      return new Promise(() => {}) // navigation takes over
    }
    throw err
  }
}

export async function signOut(config: SyncConfig): Promise<void> {
  const pca = await instance(config)
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0]
  await pca.logoutPopup({ account }).catch(() => pca.logoutRedirect({ account }))
}

export async function currentAccount(config: SyncConfig): Promise<{ name: string; username: string } | null> {
  if (!config.tenantId || !config.clientId) return null
  const pca = await instance(config)
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0]
  return account ? { name: account.name ?? account.username, username: account.username } : null
}

/**
 * A token provider for the Graph client. A fixed dev token short-circuits the
 * whole flow, which is how the test harness drives a mock Graph server.
 */
export function tokenProvider(config: SyncConfig): () => Promise<string> {
  if (config.devToken) return async () => config.devToken!
  return async () => {
    const pca = await instance(config)
    const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0]
    if (!account) throw new Error('Not signed in to Microsoft 365.')
    try {
      const res = await pca.acquireTokenSilent({ scopes: GRAPH_SCOPES, account })
      return res.accessToken
    } catch {
      const res = await pca.acquireTokenPopup({ scopes: GRAPH_SCOPES, account })
      return res.accessToken
    }
  }
}
