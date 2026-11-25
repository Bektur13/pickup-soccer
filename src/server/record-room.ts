/**
 * Call a tool on the app's RecordRoom as the app (X-App-Action → RBAC off),
 * via the DO's internal tools endpoint — the same call the scaffold makes in
 * realtime-routes.ts and action-routes.ts. Only for server-side reads/writes
 * of public or server-only collections.
 */

import type { Env } from '../../worker.js'

export type ExecTool = (
  tool: string,
  params: Record<string, unknown>,
) => Promise<{ success?: boolean; error?: string; data?: unknown }>

export function recordRoomExec(env: Env): ExecTool {
  const stub = env.RECORD_ROOMS.get(env.RECORD_ROOMS.idFromName(`app:${env.DEEPSPACE_APP_ID}`))
  return async (tool, params) => {
    const res = await stub.fetch(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': env.OWNER_USER_ID,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return (await res.json()) as { success?: boolean; error?: string; data?: unknown }
  }
}
