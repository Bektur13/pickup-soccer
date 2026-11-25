/**
 * Place search for the create-game form: OpenStreetMap Nominatim, called from
 * the worker only (CLAUDE.md rule 4) with an identifying User-Agent, and every
 * answer cached for 7 days in the `place_cache` collection — Nominatim's usage
 * policy (https://operations.osmfoundation.org/policies/nominatim/) asks for a
 * valid User-Agent, caching, and at most ~1 request/second.
 *
 * Kept free of Hono/env so it can be unit-tested with a fake cache and fetch.
 */

import type { TtlCache } from './weather-cache'

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
export const PLACE_CACHE_TTL_SECONDS = 7 * 24 * 3600
const FETCH_TIMEOUT_MS = 8000
const USER_AGENT = 'pickup-soccer/1.0 (+https://pickup-soccer.app.space)'
/** Prefer results around Bellevue (left,top,right,bottom) without excluding others. */
const BELLEVUE_VIEWBOX = '-122.30,47.70,-122.00,47.52'

export interface Place {
  /** Short name, e.g. "Crossroads Park". */
  name: string
  /** Full address line from OSM. */
  address: string
  lat: number
  lng: number
}

export interface PlaceDeps {
  cache: TtlCache
  fetch: typeof fetch
  /** Waits for a Nominatim slot; false = too busy, skip the call. Omitted in tests. */
  throttle?: () => Promise<boolean>
}

/** Minimum spacing between our Nominatim calls (their policy: ≤1 request/second). */
const MIN_GAP_MS = 1100
/** Don't make a visitor wait longer than this for a slot. */
const MAX_WAIT_MS = 4000
let nextSlotAt = 0

/**
 * Per-worker-isolate pacing: hands out Nominatim slots at least MIN_GAP_MS
 * apart. Cache hits never take a slot. It's per isolate (no shared store on
 * the free tier), so it's a brake, not a hard global limit.
 */
export async function nominatimThrottle(): Promise<boolean> {
  const now = Date.now()
  const slot = Math.max(now, nextSlotAt)
  if (slot - now > MAX_WAIT_MS) return false
  nextSlotAt = slot + MIN_GAP_MS
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  return true
}

type NominatimPlace = { lat?: string; lon?: string; display_name?: string; name?: string; error?: string }

function toPlace(r: NominatimPlace): Place | null {
  const lat = Number(r.lat)
  const lng = Number(r.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !r.display_name) return null
  const name = (r.name || r.display_name.split(',')[0] || '').trim()
  return { name, address: r.display_name, lat, lng }
}

/** GET Nominatim JSON; null on any failure (logged). */
async function nominatim(path: string, params: Record<string, string>, deps: PlaceDeps): Promise<unknown> {
  const url = new URL(path, NOMINATIM_URL)
  for (const [k, v] of Object.entries({ format: 'jsonv2', ...params })) url.searchParams.set(k, v)
  if (deps.throttle && !(await deps.throttle())) {
    console.warn(`[places] Nominatim busy — skipped ${path}`)
    return null
  }
  try {
    const res = await deps.fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[places] Nominatim ${res.status} for ${path}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.error(`[places] Nominatim request failed for ${path}: ${String(err)}`)
    return null
  }
}

async function cached<T>(key: string, deps: PlaceDeps, load: () => Promise<T | null>): Promise<T | null> {
  try {
    const hit = (await deps.cache.get(key, 'json')) as T | null
    if (hit !== null) return hit
  } catch (err) {
    console.warn(`[places] cache read failed for ${key}: ${String(err)}`)
  }
  const value = await load()
  if (value === null) return null // don't cache failures
  try {
    await deps.cache.put(key, JSON.stringify(value), { expirationTtl: PLACE_CACHE_TTL_SECONDS })
  } catch (err) {
    console.warn(`[places] cache write failed for ${key}: ${String(err)}`)
  }
  return value
}

/** Normalise a query for caching: trimmed, single spaces, lower case. */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Up to 6 places matching `q`, biased to Bellevue. null = provider error. */
export async function searchPlaces(q: string, deps: PlaceDeps): Promise<Place[] | null> {
  const query = normalizeQuery(q)
  return cached(`search:v1:${query}`, deps, async () => {
    const body = await nominatim('/search', {
      q: query,
      limit: '6',
      countrycodes: 'us',
      viewbox: BELLEVUE_VIEWBOX,
      bounded: '0',
    }, deps)
    if (!Array.isArray(body)) return null
    return (body as NominatimPlace[]).map(toPlace).filter((p): p is Place => p !== null)
  })
}

/** The address/name at a dropped pin. null = nothing found or provider error. */
export async function reversePlace(lat: number, lng: number, deps: PlaceDeps): Promise<Place | null> {
  const la = lat.toFixed(4)
  const ln = lng.toFixed(4)
  return cached(`reverse:v1:${la},${ln}`, deps, async () => {
    const body = (await nominatim('/reverse', { lat: la, lon: ln, zoom: '18' }, deps)) as NominatimPlace | null
    if (!body || body.error) return null
    const place = toPlace(body)
    // Keep the exact pin position, not the matched feature's centroid.
    return place ? { ...place, lat, lng } : null
  })
}
