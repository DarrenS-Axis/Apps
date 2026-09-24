// A stand-in for the slice of Microsoft Graph the sync layer uses: site
// lookup, lists and columns, list items with the $filter shapes the engine
// sends, and drive file upload/download. It exists so the SharePoint path is
// exercised end to end here, without a tenant.
import http from 'node:http'

export function startMockGraph(port = 4180) {
  const state = { lists: new Map(), items: new Map(), files: new Map(), nextId: 1 }
  const siteId = 'site-axis-qa'
  const driveId = 'drive-qa-files'

  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...cors })
    res.end(body === undefined ? '' : JSON.stringify(body))
  }
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Prefer',
  }

  /** Evaluates the handful of OData filters the engine emits. */
  const matches = (fields, filter) => {
    if (!filter) return true
    return filter.split(' and ').every((clause) => {
      const m = /^fields\/(\w+) (eq|gt|ge|lt) (.+)$/.exec(clause.trim())
      if (!m) return false
      const [, name, op, raw] = m
      const value = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : Number(raw)
      const have = fields[name]
      if (op === 'eq') return String(have ?? '') === String(value)
      if (op === 'gt') return Number(have ?? 0) > Number(value)
      if (op === 'ge') return Number(have ?? 0) >= Number(value)
      if (op === 'lt') return Number(have ?? 0) < Number(value)
      return false
    })
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      const path = decodeURIComponent(url.pathname).replace(/^\/v1\.0/, '')
      const auth = req.headers.authorization ?? ''

      if (req.method === 'OPTIONS') return json(res, 204)
      if (path === '/__state') {
        return json(res, 200, {
          lists: [...state.lists.values()],
          items: [...state.items.values()],
          files: [...state.files.keys()],
        })
      }
      if (path === '/__reset') {
        state.lists.clear(); state.items.clear(); state.files.clear(); state.nextId = 1
        return json(res, 200, { ok: true })
      }
      if (!auth.startsWith('Bearer ')) return json(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'No token' } })

      let m
      // Site lookup by hostname:/path
      if (req.method === 'GET' && /^\/sites\/[^/]+:\/.+/.test(path)) return json(res, 200, { id: siteId, webUrl: 'https://axis.sharepoint.com/sites/QA' })

      // Lists
      if (req.method === 'GET' && path === `/sites/${siteId}/lists`) {
        return json(res, 200, { value: [...state.lists.values()].map((l) => ({ id: l.id, displayName: l.displayName, list: l.list })) })
      }
      if (req.method === 'POST' && path === `/sites/${siteId}/lists`) {
        const b = JSON.parse(body.toString())
        const list = { id: `list-${state.nextId++}`, displayName: b.displayName, list: b.list ?? {}, columns: (b.columns ?? []).map((c) => ({ name: c.name })) }
        state.lists.set(list.id, list)
        return json(res, 201, { id: list.id, displayName: list.displayName, list: list.list })
      }
      if ((m = /^\/sites\/[^/]+\/lists\/([^/]+)\/columns$/.exec(path))) {
        const list = state.lists.get(m[1])
        if (!list) return json(res, 404, { error: { message: 'list not found' } })
        if (req.method === 'GET') return json(res, 200, { value: list.columns })
        const c = JSON.parse(body.toString())
        list.columns.push({ name: c.name })
        return json(res, 201, { name: c.name })
      }

      // Drives
      if (req.method === 'GET' && path === `/sites/${siteId}/drives`) {
        const lib = [...state.lists.values()].find((l) => l.list?.template === 'documentLibrary')
        return json(res, 200, { value: lib ? [{ id: driveId, name: lib.displayName }] : [] })
      }
      if ((m = /^\/drives\/[^/]+\/root:\/(.+):\/content$/.exec(path))) {
        if (req.method === 'PUT') {
          state.files.set(m[1], { type: req.headers['content-type'], bytes: body })
          return json(res, 201, { id: `file-${state.nextId++}`, name: m[1].split('/').pop(), size: body.length })
        }
        const f = state.files.get(m[1])
        if (!f) return json(res, 404, { error: { message: 'file not found' } })
        res.writeHead(200, { 'Content-Type': f.type ?? 'application/octet-stream', ...cors })
        return res.end(f.bytes)
      }

      // Items
      if ((m = /^\/sites\/[^/]+\/lists\/([^/]+)\/items$/.exec(path))) {
        const listId = m[1]
        if (!state.lists.has(listId)) return json(res, 404, { error: { message: 'list not found' } })
        if (req.method === 'GET') {
          const filter = url.searchParams.get('$filter')
          const expand = (url.searchParams.get('$expand') ?? '').includes('fields')
          const value = [...state.items.values()]
            .filter((i) => i.listId === listId && matches(i.fields, filter))
            .map((i) => (expand ? { id: i.id, fields: i.fields } : { id: i.id }))
          return json(res, 200, { value })
        }
        const b = JSON.parse(body.toString())
        const item = { id: String(state.nextId++), listId, fields: { ...b.fields } }
        state.items.set(item.id, item)
        return json(res, 201, { id: item.id, fields: item.fields })
      }
      if ((m = /^\/sites\/[^/]+\/lists\/([^/]+)\/items\/([^/]+)(\/fields)?$/.exec(path))) {
        const item = state.items.get(m[2])
        if (!item) return json(res, 404, { error: { code: 'itemNotFound', message: 'item not found' } })
        if (req.method === 'PATCH') {
          Object.assign(item.fields, JSON.parse(body.toString()))
          return json(res, 200, item.fields)
        }
        if (req.method === 'DELETE') {
          state.items.delete(item.id)
          return json(res, 204)
        }
        return json(res, 200, { id: item.id, fields: item.fields })
      }
      json(res, 404, { error: { code: 'notFound', message: `mock graph: no route for ${req.method} ${path}` } })
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state, port, close: () => server.close() })))
}

if (process.argv[1] && process.argv[1].endsWith('mock-graph.mjs')) {
  const { port } = await startMockGraph(Number(process.env.MOCK_GRAPH_PORT ?? 4180))
  console.log('mock graph listening on', port)
}
