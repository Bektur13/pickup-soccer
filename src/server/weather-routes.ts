/**
 * GET /api/games/:gameId/weather → GameWeather (src/lib/weather.ts)
 *
 * Public, like the games themselves (CLAUDE.md permission 1). The client sends
 * only a game id; the worker reads that game's location and kickoff from the
 * RecordRoom, so this can't be used as a general weather proxy.
 */

import type { Hono } from 'hono'
import type { AppContext } from '../../worker.js'
import { forecastForGame, type GameForWeather } from './weather.js'
import { recordRoomWeatherCache } from './weather-cache.js'
import { recordRoomExec, type ExecTool } from './record-room.js'

const GAME_ID_RE = /^[A-Za-z0-9_-]{1,200}$/

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
