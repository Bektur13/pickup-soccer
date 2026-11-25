import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nominatimThrottle, normalizeQuery, PLACE_CACHE_TTL_SECONDS, reversePlace, searchPlaces } from './places'
import type { TtlCache } from './weather-cache'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

function setup(body: unknown, status = 200) {
  const store = new Map<string, { value: string; ttl: number }>()
  const cache: TtlCache = {
    get: async (k) => (store.has(k) ? JSON.parse(store.get(k)!.value) : null),
    put: async (k, value, { expirationTtl }) => {
      store.set(k, { value, ttl: expirationTtl })
    },
  }
  const calls: { url: URL; headers: Record<string, string> }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: (init?.headers ?? {}) as Record<string, string> })
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { store, calls, deps: { cache, fetch: fetchImpl } }
}

const CROSSROADS = {
  lat: '47.6177',
  lon: '-122.1277',
  name: 'Crossroads Park',
  display_name: 'Crossroads Park, 16000, Northeast 10th Street, Bellevue, King County, Washington, 98008, United States',
}

describe('searchPlaces', () => {
  it('asks Nominatim with a User-Agent and a Bellevue bias, and maps results', async () => {
    const { deps, calls } = setup([CROSSROADS, { lat: 'x', lon: 'y', display_name: 'bad row' }])
    const places = await searchPlaces('  Crossroads   Park ', deps)

    expect(places).toEqual([
      { name: 'Crossroads Park', address: CROSSROADS.display_name, lat: 47.6177, lng: -122.1277 },
    ])
    const { url, headers } = calls[0]
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'crossroads park',
      format: 'jsonv2',
      countrycodes: 'us',
      bounded: '0',
    })
    expect(url.searchParams.get('viewbox')).toBeTruthy()
    expect(headers['User-Agent']).toMatch(/pickup-soccer/)
  })

  it('caches results for 7 days, keyed by the normalised query', async () => {
    const { deps, calls, store } = setup([CROSSROADS])
    await searchPlaces('Crossroads Park', deps)
    await searchPlaces('crossroads   PARK', deps)
    expect(calls).toHaveLength(1)
    expect([...store.values()][0].ttl).toBe(PLACE_CACHE_TTL_SECONDS)
    expect(normalizeQuery('  A   B ')).toBe('a b')
  })

  it('a Nominatim error → null, and nothing is cached', async () => {
    const { deps, store } = setup({ error: 'oops' }, 503)
    expect(await searchPlaces('park', deps)).toBeNull()
    expect(store.size).toBe(0)
  })
})

describe('nominatimThrottle', () => {
  it('spaces calls ≥1.1 s apart and refuses when the wait would exceed 4 s', async () => {
    vi.useFakeTimers()
    try {
      const granted: number[] = []
      const t0 = Date.now()
      const runs = Array.from({ length: 6 }, () =>
        nominatimThrottle().then((ok) => {
          if (ok) granted.push(Date.now() - t0)
          return ok
        }),
      )
      await vi.advanceTimersByTimeAsync(10_000)
      const results = await Promise.all(runs)
      // Slots at 0, 1.1, 2.2, 3.3 s are within the 4 s wait; later ones are refused.
      expect(results.filter(Boolean)).toHaveLength(4)
      for (let i = 1; i < granted.length; i++) expect(granted[i] - granted[i - 1]).toBeGreaterThanOrEqual(1100)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a busy throttle skips the Nominatim call', async () => {
    const { deps, calls } = setup([CROSSROADS])
    expect(await searchPlaces('crossroads', { ...deps, throttle: async () => false })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('reversePlace', () => {
  it('returns the address but keeps the exact dropped-pin position', async () => {
    const { deps, calls } = setup(CROSSROADS)
    const place = await reversePlace(47.61801, -122.12755, deps)
    expect(place).toEqual({ name: 'Crossroads Park', address: CROSSROADS.display_name, lat: 47.61801, lng: -122.12755 })
    expect(calls[0].url.pathname).toBe('/reverse')
    expect(calls[0].url.searchParams.get('lat')).toBe('47.6180')
  })

  it('"Unable to geocode" → null', async () => {
    const { deps } = setup({ error: 'Unable to geocode' })
    expect(await reversePlace(0, 0, deps)).toBeNull()
  })
})
