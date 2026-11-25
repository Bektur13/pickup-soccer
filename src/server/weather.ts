/**
 * Game forecast from Open-Meteo (free, no API key — CLAUDE.md stack), called
 * from the worker only (CLAUDE.md rule 4) and cached for 1 hour in the app's
 * KV namespace (wrangler.toml `WEATHER_CACHE`, provisioned by DeepSpace:
 * https://docs.deep.space/guides/custom-bindings).
 *
 * One Open-Meteo call fetches the whole 16-day hourly forecast for a location;
 * it's cached under the location rounded to ~1 km, so every game at the same
 * field shares one cached entry, and each game picks its kickoff hour.
 *
 * Kept free of Hono/env so it can be unit-tested with a fake cache and fetch.
 */

import { FORECAST_HORIZON_DAYS, themeForWeatherCode, type GameWeather } from '../lib/weather'

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
/** KV expirationTtl — the "1 hour cycle". */
export const WEATHER_CACHE_TTL_SECONDS = 3600
const FETCH_TIMEOUT_MS = 8000
const DAY_MS = 86_400_000
const USER_AGENT = 'pickup-soccer/1.0 (+https://pickup-soccer.app.space)'

/** The subset of KVNamespace we use (so tests can pass a fake). */
export interface WeatherCache {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
}

export interface WeatherDeps {
  cache: WeatherCache
  fetch: typeof fetch
  now: () => number
}

export interface GameForWeather {
  lat: number
  lng: number
  startsAt: string
  durationMin?: number
}

/** What we keep per location: Open-Meteo's hourly arrays, UTC hours. */
interface HourlyForecast {
  time: string[] // "2026-11-28T17:00" (UTC, timezone=GMT)
  temperatureF: number[]
  precipitationProbability: (number | null)[]
  weatherCode: number[]
}

export function cacheKey(lat: number, lng: number): string {
  return `open-meteo:v1:${lat.toFixed(2)},${lng.toFixed(2)}`
}

/** "2026-11-28T17:00" — the UTC hour containing `ms`, in Open-Meteo's GMT format. */
function utcHourKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13) + ':00'
}

async function loadHourly(lat: number, lng: number, deps: WeatherDeps): Promise<HourlyForecast | null> {
  const key = cacheKey(lat, lng)
  try {
    const cached = (await deps.cache.get(key, 'json')) as HourlyForecast | null
    if (cached?.time?.length) return cached
  } catch (err) {
    console.warn(`[weather] cache read failed for ${key}: ${String(err)}`)
  }

  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set('latitude', lat.toFixed(4))
  url.searchParams.set('longitude', lng.toFixed(4))
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('timezone', 'GMT')
  url.searchParams.set('forecast_days', String(FORECAST_HORIZON_DAYS))

  let body: {
    hourly?: {
      time?: string[]
      temperature_2m?: number[]
      precipitation_probability?: (number | null)[]
      weather_code?: number[]
    }
  }
  try {
    const res = await deps.fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[weather] Open-Meteo ${res.status} for ${key}`)
      return null
    }
    body = await res.json()
  } catch (err) {
    console.error(`[weather] Open-Meteo request failed for ${key}: ${String(err)}`)
    return null
  }

  const h = body.hourly
  if (!h?.time?.length || !h.temperature_2m || !h.weather_code) {
    console.error(`[weather] Open-Meteo returned no hourly data for ${key}`)
    return null
  }
  const hourly: HourlyForecast = {
    time: h.time,
    temperatureF: h.temperature_2m,
    precipitationProbability: h.precipitation_probability ?? h.time.map(() => null),
    weatherCode: h.weather_code,
  }

  try {
    await deps.cache.put(key, JSON.stringify(hourly), { expirationTtl: WEATHER_CACHE_TTL_SECONDS })
  } catch (err) {
    console.warn(`[weather] cache write failed for ${key}: ${String(err)}`)
  }
  return hourly
}

export async function forecastForGame(game: GameForWeather, deps: WeatherDeps): Promise<GameWeather> {
  const start = Date.parse(game.startsAt)
  if (!Number.isFinite(start)) return { available: false, reason: 'unavailable' }

  const now = deps.now()
  const end = start + (game.durationMin ?? 0) * 60_000
  if (end < now) return { available: false, reason: 'past' }

  // More than 16 days out: Open-Meteo has nothing yet — don't even ask.
  const availableFrom = new Date(start - FORECAST_HORIZON_DAYS * DAY_MS).toISOString()
  if (start - now > FORECAST_HORIZON_DAYS * DAY_MS) {
    return { available: false, reason: 'too_far', availableFrom }
  }

  const hourly = await loadHourly(game.lat, game.lng, deps)
  if (!hourly) return { available: false, reason: 'unavailable' }

  const i = hourly.time.indexOf(utcHourKey(start))
  // Inside 16 days but past the end of the returned window (the last day's
  // late hours, depending on time zone): same message as "too far".
  if (i === -1) return { available: false, reason: 'too_far', availableFrom }

  const weatherCode = hourly.weatherCode[i]
  return {
    available: true,
    theme: themeForWeatherCode(weatherCode),
    weatherCode,
    temperatureF: Math.round(hourly.temperatureF[i]),
    precipitationProbability: hourly.precipitationProbability[i] ?? null,
    forecastHour: `${hourly.time[i]}Z`,
  }
}
