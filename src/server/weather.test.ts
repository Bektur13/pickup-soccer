import { describe, expect, it } from 'vitest'
import { themeForWeatherCode } from '../lib/weather'
import { cacheKey, forecastForGame, WEATHER_CACHE_TTL_SECONDS, type WeatherCache } from './weather'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const DAY = 86_400_000

/** An Open-Meteo-shaped response: 16 days of UTC hours from today 00:00. */
function openMeteoBody(codeAt: (i: number) => number = () => 3) {
  const start = Date.parse('2026-11-24T00:00:00Z')
  const time = Array.from({ length: 16 * 24 }, (_, i) =>
    new Date(start + i * 3_600_000).toISOString().slice(0, 16),
  )
  return {
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 40 + (i % 24) + 0.4),
      precipitation_probability: time.map((_, i) => i % 100),
      weather_code: time.map((_, i) => codeAt(i)),
    },
  }
}

function setup(body: unknown = openMeteoBody(), status = 200) {
  const store = new Map<string, { value: string; ttl: number }>()
  const cache: WeatherCache = {
    get: async (key) => (store.has(key) ? JSON.parse(store.get(key)!.value) : null),
    put: async (key, value, { expirationTtl }) => {
      store.set(key, { value, ttl: expirationTtl })
    },
  }
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { store, calls, deps: { cache, fetch: fetchImpl, now: () => NOW } }
}

const game = (startsAt: string, extra = {}) => ({ lat: 47.61771, lng: -122.12769, startsAt, durationMin: 90, ...extra })

describe('themeForWeatherCode', () => {
  it.each([
    [0, 'sunny'], [1, 'sunny'],
    [2, 'cloudy'], [3, 'cloudy'], [45, 'cloudy'], [48, 'cloudy'],
    [51, 'rainy'], [57, 'rainy'], [61, 'rainy'], [65, 'rainy'], [66, 'rainy'], [80, 'rainy'], [82, 'rainy'], [95, 'rainy'], [99, 'rainy'],
    [71, 'snowy'], [75, 'snowy'], [77, 'snowy'], [85, 'snowy'], [86, 'snowy'],
    [42, 'cloudy'], // unknown → neutral
  ])('code %i → %s', (code, theme) => {
    expect(themeForWeatherCode(code)).toBe(theme)
  })
})

describe('forecastForGame', () => {
  it('returns the kickoff hour: theme, °F, rain chance', async () => {
    // hour index for 2026-11-26T17:00Z = 2 days * 24 + 17 = 65 → code 61 (rain)
    const { deps } = setup(openMeteoBody((i) => (i === 65 ? 61 : 0)))
    const w = await forecastForGame(game('2026-11-26T17:30:00Z'), deps)
    expect(w).toEqual({
      available: true,
      theme: 'rainy',
      weatherCode: 61,
      temperatureF: 57, // 40 + 17 + 0.4, rounded
      precipitationProbability: 65,
      forecastHour: '2026-11-26T17:00Z',
    })
  })

  it('asks Open-Meteo for °F, UTC hours, 16 days, at the game location', async () => {
    const { deps, calls } = setup()
    await forecastForGame(game('2026-11-26T17:00:00Z'), deps)
    const url = new URL(calls[0])
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      latitude: '47.6177',
      longitude: '-122.1277',
      temperature_unit: 'fahrenheit',
      timezone: 'GMT',
      forecast_days: '16',
    })
  })

  it('caches per location for 1 hour: a second game at the same field makes no request', async () => {
    const { deps, calls, store } = setup()
    await forecastForGame(game('2026-11-26T17:00:00Z'), deps)
    await forecastForGame(game('2026-11-28T09:00:00Z', { lat: 47.6181 }), deps) // same ~1 km cell
    expect(calls).toHaveLength(1)
    expect(store.get(cacheKey(47.6177, -122.1277))?.ttl).toBe(WEATHER_CACHE_TTL_SECONDS)
    expect(WEATHER_CACHE_TTL_SECONDS).toBe(3600)
  })

  it('more than 16 days out → too_far, without calling Open-Meteo', async () => {
    const { deps, calls } = setup()
    const startsAt = new Date(NOW + 20 * DAY).toISOString()
    const w = await forecastForGame(game(startsAt), deps)
    expect(w).toEqual({
      available: false,
      reason: 'too_far',
      availableFrom: new Date(NOW + 4 * DAY).toISOString(),
    })
    expect(calls).toHaveLength(0)
  })

  it('inside 16 days but beyond the returned hours → too_far', async () => {
    const { deps } = setup()
    const w = await forecastForGame(game('2026-12-10T05:00:00Z'), deps) // window ends 12-09 23:00
    expect(w).toMatchObject({ available: false, reason: 'too_far' })
  })

  it('a finished game → past, without calling Open-Meteo', async () => {
    const { deps, calls } = setup()
    const w = await forecastForGame(game(new Date(NOW - 3 * 3_600_000).toISOString()), deps)
    expect(w).toEqual({ available: false, reason: 'past' })
    expect(calls).toHaveLength(0)
  })

  it('Open-Meteo error → unavailable, and nothing is cached', async () => {
    const { deps, store } = setup({ error: true }, 500)
    const w = await forecastForGame(game('2026-11-26T17:00:00Z'), deps)
    expect(w).toEqual({ available: false, reason: 'unavailable' })
    expect(store.size).toBe(0)
  })
})
