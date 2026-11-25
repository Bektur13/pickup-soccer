import { describe, expect, it } from 'vitest'
import { recordRoomWeatherCache, type ExecTool } from './weather-cache'
import { WEATHER_CACHE_TTL_SECONDS } from './weather'

/** A tiny fake of the RecordRoom tools endpoint: records.get / records.create (upsert). */
function fakeRoom() {
  const rows = new Map<string, Record<string, unknown>>()
  const exec: ExecTool = async (tool, params) => {
    const id = params.recordId as string
    if (tool === 'records.get') {
      return rows.has(id)
        ? { success: true, data: { record: { recordId: id, data: rows.get(id) } } }
        : { success: false, error: 'Record not found' }
    }
    if (tool === 'records.create') {
      rows.set(id, { ...(rows.get(id) ?? {}), ...(params.data as object) })
      return { success: true, data: { recordId: id } }
    }
    return { success: false, error: `unexpected ${tool}` }
  }
  return { rows, exec }
}

describe('recordRoomWeatherCache', () => {
  it('returns what was stored until the TTL passes, then null', async () => {
    let now = 1_000_000
    const { exec } = fakeRoom()
    const cache = recordRoomWeatherCache(exec, () => now)

    expect(await cache.get('k', 'json')).toBeNull()
    await cache.put('k', JSON.stringify({ time: ['t'] }), { expirationTtl: WEATHER_CACHE_TTL_SECONDS })

    now += 59 * 60_000
    expect(await cache.get('k', 'json')).toEqual({ time: ['t'] })
    now += 2 * 60_000 // 61 minutes after the write
    expect(await cache.get('k', 'json')).toBeNull()
  })

  it('a refresh overwrites the same row', async () => {
    const { exec, rows } = fakeRoom()
    const cache = recordRoomWeatherCache(exec, () => 0)
    await cache.put('k', '"old"', { expirationTtl: 3600 })
    await cache.put('k', '"new"', { expirationTtl: 3600 })
    expect(rows.size).toBe(1)
    expect(await cache.get('k', 'json')).toBe('new')
  })

  it('a failed write throws, so the caller logs it (forecastForGame catches)', async () => {
    const cache = recordRoomWeatherCache(async () => ({ success: false, error: 'boom' }))
    await expect(cache.put('k', '{}', { expirationTtl: 3600 })).rejects.toThrow(/weather_cache write failed: boom/)
  })
})
