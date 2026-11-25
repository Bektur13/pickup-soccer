/**
 * Browser → worker calls that need the signed-in user's token.
 * Token: `getAuthToken` from deepspace (POST /api/auth/token under the hood).
 * Server actions: POST /api/actions/<name> with a Bearer token —
 * https://docs.deep.space/guides/server-actions ("Call from the client").
 */

import { getAuthToken } from 'deepspace'

export type ActionResponse<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Call a server action (src/actions). Never throws — network errors become { success: false }. */
export async function callAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => ({}))) as Partial<ActionResponse<T>> & { error?: string }
    if (res.status === 401) return { success: false, error: 'Please sign in first', code: 'unauthorized' }
    if (body.success === true) return body as ActionResponse<T>
    return { success: false, error: body.error ?? 'Something went wrong', code: (body as { code?: string }).code }
  } catch {
    return { success: false, error: 'Network error — please try again', code: 'network' }
  }
}

/** GET a JSON endpoint as the signed-in user. Throws on non-2xx with the server's message. */
export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { headers: await authHeaders(), signal })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body
}
