/**
 * A small TTL cache stored in the app's RecordRoom — one server-only
 * collection per use (`weather_cache`, `place_cache`; src/schemas/cache-schemas.ts).
 * Used instead of KV, which needs an admin DeepSpace account.
 *
 * get() returns null once a row is past its TTL; put() overwrites the row
 * (records.create with a recordId upserts — node_modules/deepspace/dist/
 * worker.d.ts ActionTools.create). Matches the WeatherCache interface.
 */

import type { WeatherCache } from './weather'
import type { ExecTool } from './record-room'

export type { ExecTool }
export type TtlCache = WeatherCache

export function recordRoomCache(exec: ExecTool, collection: string, now: () => number = Date.now): TtlCache {
  return {
    async get(key) {
      const res = await exec('records.get', { collection, recordId: key })
      const row = res.success
        ? (res.data as { record?: { data?: { payload?: string; expiresAt?: number } } })?.record?.data
        : undefined
      if (!row?.payload || typeof row.expiresAt !== 'number' || row.expiresAt <= now()) return null
      return JSON.parse(row.payload)
    },
    async put(key, value, { expirationTtl }) {
      const res = await exec('records.create', {
        collection,
        recordId: key,
        data: { payload: value, expiresAt: now() + expirationTtl * 1000 },
      })
      if (!res.success) throw new Error(`${collection} write failed: ${res.error}`)
    },
  }
}

/** The 1-hour weather cache (`weather_cache`). */
export function recordRoomWeatherCache(exec: ExecTool, now: () => number = Date.now): TtlCache {
  return recordRoomCache(exec, 'weather_cache', now)
}
