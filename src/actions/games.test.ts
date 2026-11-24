/**
 * Unit tests for joinGame / leaveGame against a fake RecordRoom that mimics the
 * real one's guarantees (node_modules/deepspace/dist/worker.js putRecord):
 *   - each tool call executes atomically (one synchronous step),
 *   - but separate calls from concurrent actions interleave (random delays
 *     before and after each call, like separate DO requests),
 *   - `uniqueOn: ['gameId','slot']` on registrations → "Duplicate: …",
 *   - `create` with a recordId upserts,
 *   - `userBound` userId is stamped with the caller.
 *
 * The end-to-end two-browser version lives in tests/ (needs test accounts).
 */

import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import { joinGame, leaveGame } from './games'
import { registrationId } from '../schemas/registrations-schema'

type Row = { recordId: string; data: Record<string, unknown> }

function jitter() {
  return new Promise<void>((r) => setTimeout(r, Math.random() * 4))
}

class FakeRoom {
  tables = new Map<string, Map<string, Row>>()
  table(name: string) {
    let t = this.tables.get(name)
    if (!t) this.tables.set(name, (t = new Map()))
    return t
  }

  /** Tools as seen by one caller. Every call: delay → atomic step → delay. */
  toolsFor(userId: string): ActionTools {
    const call = async <T>(step: () => T): Promise<T> => {
      await jitter()
      const out = step() // synchronous = atomic, like putRecord in the DO
      await jitter()
      return out
    }
    const notFound = { success: false as const, error: 'Record not found' }

    const tools = {
      get: (collection: string, recordId: string) =>
        call(() => {
          const row = this.table(collection).get(recordId)
          return row ? { success: true, data: { record: { ...row, data: { ...row.data } } } } : notFound
        }),
      query: (collection: string, opts?: { where?: Record<string, unknown>; limit?: number }) =>
        call(() => {
          const rows = [...this.table(collection).values()].filter((r) =>
            Object.entries(opts?.where ?? {}).every(([k, v]) => r.data[k] === v),
          )
          const records = rows.slice(0, opts?.limit ?? 50).map((r) => ({ ...r, data: { ...r.data } }))
          return { success: true, data: { records, count: records.length } }
        }),
      create: (collection: string, data: Record<string, unknown>, recordId?: string) =>
        call(() => {
          const t = this.table(collection)
          const id = recordId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const existing = t.get(id)
          const next = { ...(existing?.data ?? {}), ...data }
          if (collection === 'registrations') {
            next.userId = existing ? existing.data.userId : userId // userBound
            const clash = [...t.values()].some(
              (r) => r.recordId !== id && r.data.gameId === next.gameId && r.data.slot === next.slot,
            )
            if (clash) {
              return {
                success: false,
                error: `Duplicate: a record with gameId=${next.gameId}, slot=${next.slot} already exists in registrations`,
              }
            }
          }
          t.set(id, { recordId: id, data: next })
          return { success: true, data: { recordId: id } }
        }),
      update: (collection: string, recordId: string, data: Record<string, unknown>) =>
        call(() => {
          const row = this.table(collection).get(recordId)
          if (!row) return notFound
          row.data = { ...row.data, ...data }
          return { success: true, data: { recordId } }
        }),
      remove: (collection: string, recordId: string) =>
        call(() =>
          this.table(collection).delete(recordId) ? { success: true, data: { recordId } } : notFound,
        ),
    }
    return tools as unknown as ActionTools
  }

  addGame(id: string, overrides: Record<string, unknown> = {}) {
    this.table('games').set(id, {
      recordId: id,
      data: {
        organizerId: 'org',
        title: 'Test game',
        fieldName: 'Crossroads Park',
        lat: 47.6,
        lng: -122.2,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        durationMin: 90,
        maxPlayers: 6,
        playerCount: 0,
        skillLevel: 'casual',
        surface: 'grass',
        status: 'open',
        ...overrides,
      },
    })
  }

  game(id: string) {
    return this.table('games').get(id)!.data
  }
  registrations(gameId: string) {
    return [...this.table('registrations').values()].filter((r) => r.data.gameId === gameId)
  }
}

type Ctx = Parameters<typeof joinGame>[0]
function ctx(room: FakeRoom, userId: string, gameId: string): Ctx {
  return { userId, params: { gameId }, tools: room.toolsFor(userId), env: {}, callerJwt: '' } as unknown as Ctx
}

/** Seed n existing registrations (slots 1..n) directly, as earlier joins would have. */
function fillTo(room: FakeRoom, gameId: string, n: number) {
  for (let i = 1; i <= n; i++) {
    const id = registrationId(gameId, `filler${i}`)
    room.table('registrations').set(id, {
      recordId: id,
      data: { gameId, userId: `filler${i}`, userName: `Filler ${i}`, slot: i },
    })
  }
  Object.assign(room.game(gameId), { playerCount: n })
}

const RACE_TIMEOUT_MS = 30_000

describe('joinGame', () => {
  it('two users racing for the last spot: exactly one succeeds (×40 runs)', async () => {
    for (let run = 0; run < 40; run++) {
      const room = new FakeRoom()
      room.addGame('g', { maxPlayers: 6 })
      fillTo(room, 'g', 5)

      const results = await Promise.all([
        joinGame(ctx(room, 'alice', 'g')),
        joinGame(ctx(room, 'bob', 'g')),
      ])

      const winners = results.filter((r) => r.success)
      expect(winners).toHaveLength(1)
      expect(results.find((r) => !r.success)).toMatchObject({ code: 'full' })
      expect(room.registrations('g')).toHaveLength(6)
      expect(room.game('g')).toMatchObject({ playerCount: 6, status: 'full' })
    }
  }, RACE_TIMEOUT_MS)

  it('a crowd joining at once never overbooks, and the count matches', async () => {
    for (let run = 0; run < 15; run++) {
      const room = new FakeRoom()
      room.addGame('g', { maxPlayers: 10 })

      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) => joinGame(ctx(room, `u${i}`, 'g'))),
      )

      const regs = room.registrations('g')
      const slots = regs.map((r) => r.data.slot)
      expect(regs.length).toBeLessThanOrEqual(10)
      expect(new Set(slots).size).toBe(regs.length) // no shared slot
      expect(results.filter((r) => r.success)).toHaveLength(regs.length)
      for (const r of results) if (!r.success) expect(['full', 'busy']).toContain(r.code)
      expect(room.game('g').playerCount).toBe(regs.length)
      expect(room.game('g').status).toBe(regs.length >= 10 ? 'full' : 'open')
    }
  }, RACE_TIMEOUT_MS)

  it('the same user joining twice at once keeps one registration', async () => {
    const room = new FakeRoom()
    room.addGame('g')
    const results = await Promise.all([
      joinGame(ctx(room, 'alice', 'g')),
      joinGame(ctx(room, 'alice', 'g')),
    ])
    expect(results.every((r) => r.success)).toBe(true)
    expect(room.registrations('g')).toHaveLength(1)
    expect(room.registrations('g')[0].recordId).toBe(registrationId('g', 'alice'))
    expect(room.game('g').playerCount).toBe(1)
  })

  it('refuses games that are full, cancelled, past, or already started', async () => {
    const room = new FakeRoom()
    room.addGame('full', { status: 'full' })
    room.addGame('cancelled', { status: 'cancelled' })
    room.addGame('past', { status: 'past' })
    room.addGame('started', { startsAt: new Date(Date.now() - 60_000).toISOString() })

    expect(await joinGame(ctx(room, 'a', 'full'))).toMatchObject({ success: false, code: 'full' })
    expect(await joinGame(ctx(room, 'a', 'cancelled'))).toMatchObject({ success: false, code: 'not_open' })
    expect(await joinGame(ctx(room, 'a', 'past'))).toMatchObject({ success: false, code: 'not_open' })
    expect(await joinGame(ctx(room, 'a', 'started'))).toMatchObject({ success: false, code: 'started' })
    expect(await joinGame(ctx(room, 'a', 'nope'))).toMatchObject({ success: false, code: 'not_found' })
  })
})

describe('leaveGame', () => {
  it('frees the spot and reopens a full game', async () => {
    const room = new FakeRoom()
    room.addGame('g', { maxPlayers: 2 })
    await joinGame(ctx(room, 'alice', 'g'))
    await joinGame(ctx(room, 'bob', 'g'))
    expect(room.game('g')).toMatchObject({ playerCount: 2, status: 'full' })

    expect(await leaveGame(ctx(room, 'bob', 'g'))).toMatchObject({ success: true, data: { left: true } })
    expect(room.game('g')).toMatchObject({ playerCount: 1, status: 'open' })

    // Bob's freed slot can be taken again.
    expect((await joinGame(ctx(room, 'carol', 'g'))).success).toBe(true)
    expect(room.game('g')).toMatchObject({ playerCount: 2, status: 'full' })
  })

  it('does not reopen a cancelled game, and is a no-op if not joined', async () => {
    const room = new FakeRoom()
    room.addGame('g', { maxPlayers: 2 })
    await joinGame(ctx(room, 'alice', 'g'))
    room.game('g').status = 'cancelled'

    await leaveGame(ctx(room, 'alice', 'g'))
    expect(room.game('g')).toMatchObject({ playerCount: 0, status: 'cancelled' })
    expect(await leaveGame(ctx(room, 'zed', 'g'))).toMatchObject({ success: true, data: { notJoined: true } })
  })
})
