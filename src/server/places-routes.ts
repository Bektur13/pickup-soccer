/**
 * Place lookup:
 *   GET /api/places/search?q=crossroads%20park   → { places: Place[] }   (public)
 *   GET /api/places/reverse?lat=47.61&lng=-122.12 → { place: Place | null } (signed in)
 * 502 when Nominatim is unreachable or busy.
 *
 * Search is public because anyone can browse the map (CLAUDE.md permission 1)
 * and the top-bar search is part of browsing. It's protected by the 7-day
 * cache, the 3–100 character rule, client debounce, and server-side pacing
 * (nominatimThrottle, ~1 request/second per isolate). Reverse lookup is only
 * used when a signed-in user drops a pin for a new game.
 */

import type { Hono } from 'hono'
import type { AppContext } from '../../worker.js'
import { resolveAuth } from './http-routes.js'
import { recordRoomExec } from './record-room.js'
import { recordRoomCache } from './weather-cache.js'
import { nominatimThrottle, reversePlace, searchPlaces, type PlaceDeps } from './places.js'

function deps(c: { env: AppContext['Bindings'] }): PlaceDeps {
  return {
    cache: recordRoomCache(recordRoomExec(c.env), 'place_cache'),
    fetch: (input, init) => fetch(input, init),
    throttle: nominatimThrottle,
  }
}

export function registerPlacesRoutes(app: Hono<AppContext>): void {
  app.get('/api/places/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q.length < 3 || q.length > 100) return c.json({ error: 'Query must be 3–100 characters' }, 400)

    const places = await searchPlaces(q, deps(c))
    if (places === null) return c.json({ error: 'Place search is unavailable right now' }, 502)
    return c.json({ places }, 200, { 'Cache-Control': 'public, max-age=3600' })
  })

  app.get('/api/places/reverse', async (c) => {
    if (!(await resolveAuth(c.req.raw, c.env))) return c.json({ error: 'Sign in required' }, 401)
    const lat = Number(c.req.query('lat'))
    const lng = Number(c.req.query('lng'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return c.json({ error: 'Invalid coordinates' }, 400)
    }
    return c.json({ place: await reversePlace(lat, lng, deps(c)) })
  })
}
