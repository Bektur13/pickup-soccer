/**
 * Unit tests for joinGame / leaveGame against FakeRoom (./__tests__/fake-room),
 * which mimics the RecordRoom's atomic single writes, uniqueOn and upserts,
 * while letting concurrent actions interleave between tool calls.
 *
 * The end-to-end two-browser version lives in tests/ (needs test accounts).
 */

import { describe, expect, it } from 'vitest'
import { joinGame, leaveGame } from './games'
import { registrationId } from '../schemas/registrations-schema'
import { chatMemberId } from '../schemas/chat-schema'
import { ctx as baseCtx, FakeRoom } from './__tests__/fake-room'

const ctx = (room: FakeRoom, userId: string, gameId: string) => baseCtx(room, userId, { gameId })

/** Seed n existing registrations (slots 1..n) directly, as earlier joins would have. */
function fillTo(room: FakeRoom, gameId: string, n: number) {
  for (let i = 1; i <= n; i++) {
    const id = registrationId(gameId, `filler${i}`)
    room.table('registrations').set(id, {
      recordId: id,
      createdBy: `filler${i}`,
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
      expect(room.rows('registrations', { gameId: 'g' })).toHaveLength(6)
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

      const regs = room.rows('registrations', { gameId: 'g' })
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
    const regs = room.rows('registrations', { gameId: 'g' })
    expect(regs).toHaveLength(1)
    expect(regs[0].recordId).toBe(registrationId('g', 'alice'))
    expect(room.game('g').playerCount).toBe(1)
  })

  it('gives the new player chat membership', async () => {
    const room = new FakeRoom()
    room.addGame('g')
    await joinGame(ctx(room, 'alice', 'g'))
    expect(room.table('team_members').get(chatMemberId('g', 'alice'))?.data).toMatchObject({
      teamId: 'g',
      userId: 'alice',
      status: 'active',
    })
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

  it('ends chat membership for a player, but not for the organizer', async () => {
    const room = new FakeRoom()
    room.addGame('g', { organizerId: 'org' })
    await joinGame(ctx(room, 'bob', 'g'))
    await joinGame(ctx(room, 'org', 'g')) // organizer also plays

    await leaveGame(ctx(room, 'bob', 'g'))
    await leaveGame(ctx(room, 'org', 'g'))

    expect(room.table('team_members').has(chatMemberId('g', 'bob'))).toBe(false)
    expect(room.table('team_members').has(chatMemberId('g', 'org'))).toBe(true)
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
