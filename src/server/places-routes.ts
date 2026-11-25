/**
 * Place lookup for the create-game form (signed-in users only — only they can
 * create games, and it keeps the Nominatim traffic ours):
 *   GET /api/places/search?q=crossroads%20park   → { places: Place[] }
 *   GET /api/places/reverse?lat=47.61&lng=-122.12 → { place: Place | null }
 * 502 when Nominatim is unreachable.
 */

import type { Hono } from 'hono'
import type { AppContext } from '../../worker.js'
import { resolveAuth } from './http-routes.js'
import { recordRoomExec } from './record-room.js'
import { recordRoomCache } from './weather-cache.js'
import { reversePlace, searchPlaces, type PlaceDeps } from './places.js'

function deps(c: { env: AppContext['Bindings'] }): PlaceDeps {
  return {
    cache: recordRoomCache(recordRoomExec(c.env), 'place_cache'),
    fetch: (input, init) => fetch(input, init),
  }
}

export function registerPlacesRoutes(app: Hono<AppContext>): void {
  app.get('/api/places/search', async (c) => {
    if (!(await resolveAuth(c.req.raw, c.env))) return c.json({ error: 'Sign in required' }, 401)
    const q = (c.req.query('q') ?? '').trim()
    if (q.length < 3 || q.length > 100) return c.json({ error: 'Query must be 3–100 characters' }, 400)

    const places = await searchPlaces(q, deps(c))
    if (places === null) return c.json({ error: 'Place search is unavailable right now' }, 502)
    return c.json({ places })
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
