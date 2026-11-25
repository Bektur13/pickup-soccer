/**
 * weather_cache — Open-Meteo forecasts cached in the app's own RecordRoom for
 * 1 hour (see src/server/weather-cache.ts). One row per ~1 km location; the
 * recordId is the cache key and each refresh overwrites the row.
 *
 * Why not KV: custom Cloudflare bindings (KV, R2, D1, …) need an admin
 * DeepSpace account; on the free tier the deploy refuses them.
 *
 * Server-only: no browser role can read or write it.
 */

import type { CollectionSchema } from 'deepspace/schema'

const NO_ACCESS = { read: false, create: false, update: false, delete: false } as const

export const weatherCacheSchema: CollectionSchema = {
  name: 'weather_cache',
  columns: [
    // The hourly forecast arrays, JSON-encoded (~10 KB).
    { name: 'payload', storage: 'text', interpretation: 'plain', required: true },
    // Epoch ms after which the row is stale.
    { name: 'expiresAt', storage: 'number', interpretation: 'plain', required: true },
  ],
  permissions: {
    '*': NO_ACCESS,
    viewer: NO_ACCESS,
    member: NO_ACCESS,
    admin: NO_ACCESS,
  },
}
