/**
 * useGameWeather — the forecast for a game's kickoff hour, from the worker
 * endpoint GET /api/games/:gameId/weather (Open-Meteo, cached 1 h in KV).
 * Refetches when the game or its start time changes.
 */

import { useEffect, useState } from 'react'
import type { GameWeather } from '../lib/weather'

export type GameWeatherState =
  | { status: 'loading' }
  | { status: 'ready'; weather: GameWeather }
  | { status: 'error' }

export function useGameWeather(gameId: string, startsAt: string): GameWeatherState {
  const key = `${gameId}|${startsAt}`
  const [result, setResult] = useState<{ key: string; weather?: GameWeather; error?: true } | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/games/${encodeURIComponent(gameId)}/weather`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`weather ${res.status}`)
        return (await res.json()) as GameWeather
      })
      .then((weather) => setResult({ key, weather }))
      .catch(() => {
        if (!ctrl.signal.aborted) setResult({ key, error: true })
      })
    return () => ctrl.abort()
  }, [key, gameId])

  if (!result || result.key !== key) return { status: 'loading' }
  return result.error || !result.weather ? { status: 'error' } : { status: 'ready', weather: result.weather }
}
