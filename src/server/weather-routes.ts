/**
 * GET /api/games/:gameId/weather → GameWeather (src/lib/weather.ts)
 *
 * Public, like the games themselves (CLAUDE.md permission 1). The client sends
 * only a game id; the worker reads that game's location and kickoff from the
 * RecordRoom, so this can't be used as a general weather proxy.
 */

import type { Hono } from 'hono'
import type { AppContext, Env } from '../../worker.js'
import { forecastForGame, type GameForWeather } from './weather.js'
import { recordRoomWeatherCache, type ExecTool } from './weather-cache.js'

const GAME_ID_RE = /^[A-Za-z0-9_-]{1,200}$/

/**
 * Call a RecordRoom tool as the app (X-App-Action) — the same internal
 * endpoint the scaffold uses in realtime-routes.ts. Games are public, and the
 * weather cache is server-only, so nothing private leaves through here.
 */
function recordRoomExec(env: Env): ExecTool {
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

/** One game's location/time — only these four fields are used. */
async function readGame(exec: ExecTool, gameId: string): Promise<GameForWeather | null> {
  const json = await exec('records.get', { collection: 'games', recordId: gameId })
  const d = json.success
    ? (json.data as { record?: { data?: Partial<GameForWeather> } })?.record?.data
    : undefined
  if (!d || typeof d.lat !== 'number' || typeof d.lng !== 'number' || typeof d.startsAt !== 'string') {
    return null
  }
  return { lat: d.lat, lng: d.lng, startsAt: d.startsAt, durationMin: d.durationMin }
}

export function registerWeatherRoutes(app: Hono<AppContext>): void {
  app.get('/api/games/:gameId/weather', async (c) => {
    const gameId = c.req.param('gameId')
    if (!GAME_ID_RE.test(gameId)) return c.json({ error: 'Invalid game id' }, 400)

    const exec = recordRoomExec(c.env)
    const game = await readGame(exec, gameId)
    if (!game) return c.json({ error: 'Game not found' }, 404)

    const weather = await forecastForGame(game, {
      cache: recordRoomWeatherCache(exec),
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
    })
    // Browsers may reuse it briefly; the real cache is the weather_cache collection (1 hour).
    return c.json(weather, 200, { 'Cache-Control': 'public, max-age=300' })
  })
}
