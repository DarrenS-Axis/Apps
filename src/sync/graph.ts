/**
 * The slice of Microsoft Graph the app needs, over plain fetch.
 *
 * The base URL is a parameter rather than a constant so the test harness can
 * stand in a mock server — nothing here knows whether it is talking to
 * graph.microsoft.com or to http://127.0.0.1:4180.
 */
export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}

export type TokenProvider = () => Promise<string>

export class GraphClient {
  constructor(
    private readonly getToken: TokenProvider,
    readonly base = 'https://graph.microsoft.com/v1.0',
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
    const token = await this.getToken()
    const url = path.startsWith('http') ? path : `${this.base}${path}`
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...extra }
    let payload: BodyInit | undefined
    if (body instanceof Blob || body instanceof ArrayBuffer) {
      payload = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(url, { method, headers, body: payload })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    let data: unknown = undefined
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = text
    }
    if (!res.ok) {
      const err = (data as { error?: { message?: string; code?: string } })?.error
      throw new GraphError(err?.message ?? `${method} ${path} failed (${res.status})`, res.status, err?.code)
    }
    return data as T
  }

  get<T>(path: string, extra?: Record<string, string>): Promise<T> {
    return this.call<T>('GET', path, undefined, extra)
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('POST', path, body)
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PATCH', path, body)
  }
  delete(path: string): Promise<void> {
    return this.call<void>('DELETE', path)
  }
  /** Uploads a file body; Graph wants the raw bytes with the content type. */
  put<T>(path: string, body: Blob, contentType: string): Promise<T> {
    return this.call<T>('PUT', path, body, { 'Content-Type': contentType })
  }

  /** Follows @odata.nextLink until the collection is exhausted. */
  async all<T>(path: string, extra?: Record<string, string>): Promise<T[]> {
    const out: T[] = []
    let next: string | undefined = path
    while (next) {
      const page: { value: T[]; '@odata.nextLink'?: string } = await this.get(next, extra)
      out.push(...page.value)
      next = page['@odata.nextLink']
    }
    return out
  }
}
