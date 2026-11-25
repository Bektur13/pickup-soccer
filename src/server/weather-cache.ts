/**
 * The 1-hour weather cache, stored in the app's RecordRoom (`weather_cache`
 * collection) instead of KV — KV needs an admin DeepSpace account.
 *
 * Implements the WeatherCache interface from ./weather, so the forecast logic
 * is unchanged: get() returns null once a row is older than its TTL, and put()
 * overwrites the row (records.create with a recordId upserts —
 * node_modules/deepspace/dist/worker.d.ts ActionTools.create).
 *
 * Reads/writes go through the RecordRoom's internal tools endpoint as the app
 * (X-App-Action), the same call the scaffold uses in realtime-routes.ts.
 */

import type { WeatherCache } from './weather'

export type ExecTool = (
  tool: string,
  params: Record<string, unknown>,
) => Promise<{ success?: boolean; error?: string; data?: unknown }>

const COLLECTION = 'weather_cache'

export function recordRoomWeatherCache(exec: ExecTool, now: () => number = Date.now): WeatherCache {
  return {
    async get(key) {
      const res = await exec('records.get', { collection: COLLECTION, recordId: key })
      const row = res.success
        ? (res.data as { record?: { data?: { payload?: string; expiresAt?: number } } })?.record?.data
        : undefined
      if (!row?.payload || typeof row.expiresAt !== 'number' || row.expiresAt <= now()) return null
      return JSON.parse(row.payload)
    },
    async put(key, value, { expirationTtl }) {
      const res = await exec('records.create', {
        collection: COLLECTION,
        recordId: key,
        data: { payload: value, expiresAt: now() + expirationTtl * 1000 },
      })
      if (!res.success) throw new Error(`weather_cache write failed: ${res.error}`)
    },
  }
}
