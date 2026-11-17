// Microsoft Graph access for the labour sheet: sign-in (MSAL), locating the
// workbook from its SharePoint link, and reading / writing cells through the
// Excel API. Every read and write goes straight to the workbook in SharePoint,
// so the Excel file stays the master copy and people editing it in Excel see
// the app's changes (and the other way round).

export const SCOPES = ['User.Read', 'Files.ReadWrite.All']

export class GraphError extends Error {
  constructor(status, code, message) {
    super(message || `Graph request failed (${status})`)
    this.status = status
    this.code = code
  }
}

/** MSAL sign-in. `msal` is the global from vendor/msal-browser.min.js. */
export class Auth {
  constructor({ tenantId, clientId, devToken }) {
    this.devToken = devToken
    if (devToken) return
    this.pca = new msal.PublicClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        // This page's own address; it must be listed as a single-page
        // application redirect URI on the app registration.
        redirectUri: location.origin + location.pathname.replace(/index\.html$/, ''),
      },
      cache: { cacheLocation: 'localStorage' },
    })
  }

  async init() {
    if (this.devToken) return { name: 'Test user', username: 'test@example.com' }
    const res = await this.pca.handleRedirectPromise()
    if (res && res.account) this.pca.setActiveAccount(res.account)
    const acc = this.account()
    return acc ? { name: acc.name || acc.username, username: acc.username } : null
  }

  account() {
    return this.pca.getActiveAccount() || this.pca.getAllAccounts()[0] || null
  }

  signIn() {
    return this.pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' })
  }

  signOut() {
    return this.pca.logoutRedirect({ account: this.account() })
  }

  async token() {
    if (this.devToken) return this.devToken
    const account = this.account()
    if (!account) throw new GraphError(401, 'signedOut', 'Not signed in.')
    try {
      return (await this.pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken
    } catch (err) {
      if (err instanceof msal.InteractionRequiredAuthError) {
        await this.pca.acquireTokenRedirect({ scopes: SCOPES, account })
        return new Promise(() => {}) // the page navigates away
      }
      throw err
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class Graph {
  constructor(auth, base = 'https://graph.microsoft.com/v1.0') {
    this.auth = auth
    this.base = base
  }

  async req(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.token()
      let res
      try {
        res = await fetch(this.base + path, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        })
      } catch (err) {
        if (attempt < 3) { await sleep(1000 * 2 ** attempt); continue }
        throw new GraphError(0, 'network', 'No connection to Microsoft 365.')
      }
      // Throttled or the Excel service is busy: wait and try again.
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 4) {
        const after = Number(res.headers.get('Retry-After')) || 2 ** attempt
        await sleep(Math.min(after, 30) * 1000)
        continue
      }
      if (res.status === 204) return null
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        const e = json && json.error
        throw new GraphError(res.status, e && e.code, e && e.message)
      }
      return json
    }
  }

  me() {
    return this.req('GET', '/me?$select=displayName,mail,userPrincipalName')
  }
}

/** Graph's encoding of a sharing link for /shares/{id}. */
export function shareId(url) {
  const bytes = new TextEncoder().encode(url)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'u!' + btoa(bin).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * Finds the workbook. First through the sharing link; if the link can't be
 * resolved (some link types can't), by searching the SharePoint site the link
 * points into for a workbook whose name matches.
 */
export async function locateWorkbook(graph, fileUrl, nameHint) {
  const clean = fileUrl.split('?')[0]
  const select = '$select=id,name,webUrl,parentReference,cTag,lastModifiedDateTime,lastModifiedBy'
  try {
    const item = await graph.req('GET', `/shares/${shareId(clean)}/driveItem?${select}`)
    return item
  } catch (err) {
    if (err.status === 401) throw err
    const m = clean.match(/^https:\/\/([^/]+)\/(?::\w:\/)?(?:s|sites)\/([^/]+)/)
    if (!m) throw err
    const site = await graph.req('GET', `/sites/${m[1]}:/sites/${m[2]}?$select=id`)
    const q = encodeURIComponent((nameHint || 'Labour').replace(/'/g, "''"))
    const found = await graph.req('GET', `/sites/${site.id}/drive/root/search(q='${q}')?${select}`)
    const hit = (found.value || []).find((i) => /\.xlsx?m?$/i.test(i.name))
    if (!hit) throw err
    return hit
  }
}

export class Workbook {
  constructor(graph, item) {
    this.graph = graph
    this.driveId = item.parentReference.driveId
    this.itemId = item.id
    this.name = item.name
    this.webUrl = item.webUrl
  }

  get itemPath() {
    return `/drives/${this.driveId}/items/${this.itemId}`
  }

  sheetPath(sheet) {
    return `${this.itemPath}/workbook/worksheets/${encodeURIComponent(sheet)}`
  }

  /** Cheap check for "has anyone changed the file". */
  stamp() {
    return this.graph.req('GET', `${this.itemPath}?$select=cTag,eTag,lastModifiedDateTime,lastModifiedBy`)
  }

  async sheets() {
    const res = await this.graph.req('GET', `${this.itemPath}/workbook/worksheets?$select=name,position,visibility`)
    return res.value.filter((s) => s.visibility === 'Visible').sort((a, b) => a.position - b.position)
  }

  /**
   * Every cell in the sheet's used range, as { values, formulas } (both
   * row-major, starting at A1). Wide sheets are read in column bands so no
   * single response gets too big for the Excel service.
   */
  async readSheet(sheet) {
    const used = await this.graph.req('GET', `${this.sheetPath(sheet)}/usedRange(valuesOnly=true)?$select=address`)
    const addr = used.address.split('!').pop()
    const end = parseCell(addr.split(':').pop() || addr)
    const rows = end.row + 1
    const cols = end.col + 1
    const values = Array.from({ length: rows }, () => new Array(cols).fill(''))
    const formulas = Array.from({ length: rows }, () => new Array(cols).fill(''))
    const band = 120
    const jobs = []
    for (let c0 = 0; c0 < cols; c0 += band) {
      const c1 = Math.min(cols, c0 + band) - 1
      jobs.push(async () => {
        const a = `${colName(c0)}1:${colName(c1)}${rows}`
        const r = await this.graph.req('GET', `${this.sheetPath(sheet)}/range(address='${a}')?$select=values,formulas`)
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j <= c1 - c0; j++) {
            values[i][c0 + j] = r.values[i][j]
            formulas[i][c0 + j] = r.formulas[i][j]
          }
        }
      })
    }
    // Three at a time keeps the Excel service from throttling us.
    for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map((f) => f()))
    return { values, formulas, rows, cols }
  }

  readRange(sheet, address) {
    return this.graph.req('GET', `${this.sheetPath(sheet)}/range(address='${address}')?$select=values`)
  }

  writeRange(sheet, address, values) {
    return this.graph.req('PATCH', `${this.sheetPath(sheet)}/range(address='${address}')`, { values })
  }
}

export function colName(i) {
  let s = ''
  i += 1
  while (i > 0) {
    const m = (i - 1) % 26
    s = String.fromCharCode(65 + m) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

export function parseCell(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim())
  if (!m) throw new Error(`Bad cell reference ${ref}`)
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]) - 1, col: col - 1 }
}

export function address(r0, c0, r1 = r0, c1 = c0) {
  const a = `${colName(c0)}${r0 + 1}`
  return r0 === r1 && c0 === c1 ? a : `${a}:${colName(c1)}${r1 + 1}`
}
