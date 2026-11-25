/**
 * Server-only TTL caches stored in the app's RecordRoom (src/server/weather-cache.ts):
 *   weather_cache — Open-Meteo forecasts, 1 hour, one row per ~1 km location
 *   place_cache   — OpenStreetMap Nominatim search/reverse results, 7 days
 * The recordId is the cache key; each refresh overwrites the row.
 *
 * Why not KV: custom Cloudflare bindings (KV, R2, D1, …) need an admin
 * DeepSpace account; on the free tier the deploy refuses them.
 *
 * No browser role can read or write these.
 */

import type { CollectionSchema } from 'deepspace/schema'

const NO_ACCESS = { read: false, create: false, update: false, delete: false } as const

function cacheSchema(name: string): CollectionSchema {
  return {
    name,
    columns: [
      // The cached value, JSON-encoded.
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
}

export const weatherCacheSchema = cacheSchema('weather_cache')
export const placeCacheSchema = cacheSchema('place_cache')
