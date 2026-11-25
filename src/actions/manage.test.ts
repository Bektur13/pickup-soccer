import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelGame, updateGame, validatePatch } from './manage'
import { joinGame, leaveGame } from './games'
import { chatMemberId } from '../schemas/chat-schema'
import { ctx, FakeRoom } from './__tests__/fake-room'

const ENV = { RESEND_API_KEY: 'fake-resend-key-for-tests' }
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString()

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup() {
  const room = new FakeRoom()
  room.addGame('g', { organizerId: 'org', title: 'Saturday 7v7', maxPlayers: 10 })
  for (const id of ['org', 'alice', 'bob', 'carol']) {
    room.table('users').set(id, { recordId: id, createdBy: id, data: { name: id, email: `${id}@example.com` } })
  }
  return room
}

const update = (room: FakeRoom, userId: string, patch: Record<string, unknown>) =>
  updateGame(ctx(room, userId, { gameId: 'g', patch }, ENV))

describe('updateGame', () => {
  it('lets the organizer edit details; the change is saved', async () => {
    const room = setup()
    const r = await update(room, 'org', { title: 'Sunday 7v7', cost: '$5', startsAt: future(3), surface: 'turf' })
    expect(r).toMatchObject({ success: true })
    expect(room.game('g')).toMatchObject({ title: 'Sunday 7v7', cost: '$5', surface: 'turf' })
  })

  it('refuses everyone but the organizer — including players in the game', async () => {
    const room = setup()
    await joinGame(ctx(room, 'alice', { gameId: 'g' }))
    expect(await update(room, 'alice', { title: 'Hijacked' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(await update(room, 'carol', { title: 'Hijacked' })).toMatchObject({ success: false, code: 'forbidden' })
    expect(room.game('g').title).toBe('Saturday 7v7')
  })

  it('validates like the create form', async () => {
    const room = setup()
    for (const patch of [
      { title: '   ' },
      { startsAt: new Date(Date.now() - 60_000).toISOString() },
      { maxPlayers: 1 },
      { maxPlayers: 31 },
      { durationMin: 10 },
      { skillLevel: 'pro' },
      { notes: 'x'.repeat(1001) },
      { playerCount: 0 }, // not an editable field → nothing to update
    ]) {
      expect(await update(room, 'org', patch)).toMatchObject({ success: false })
    }
    expect(validatePatch({ status: 'open' })).toEqual({ error: 'Nothing to update' })
  })

  it('max players can’t go below the players already in', async () => {
    const room = setup()
    for (const p of ['alice', 'bob', 'carol']) await joinGame(ctx(room, p, { gameId: 'g' }))
    expect(await update(room, 'org', { maxPlayers: 2 })).toMatchObject({ success: false, code: 'too_low' })
    // Exactly the number joined is fine — and the game becomes full.
    expect(await update(room, 'org', { maxPlayers: 3 })).toMatchObject({ success: true })
    expect(room.game('g')).toMatchObject({ maxPlayers: 3, status: 'full', playerCount: 3 })
    // Raising it again reopens the game.
    await update(room, 'org', { maxPlayers: 6 })
    expect(room.game('g')).toMatchObject({ status: 'open' })
  })

  it('…nor below the highest spot taken (gaps after people leave)', async () => {
    const room = setup()
    for (const p of ['alice', 'bob', 'carol']) await joinGame(ctx(room, p, { gameId: 'g' }))
    await leaveGame(ctx(room, 'alice', { gameId: 'g' })) // spots left: #2, #3 (2 players)
    const r = await update(room, 'org', { maxPlayers: 2 })
    expect(r).toMatchObject({ success: false, code: 'too_low' })
  })

  it('a cancelled game can’t be edited', async () => {
    const room = setup()
    room.game('g').status = 'cancelled'
    expect(await update(room, 'org', { title: 'x y' })).toMatchObject({ success: false, code: 'closed' })
  })
})

describe('cancelGame', () => {
  it('only the organizer can cancel', async () => {
    const room = setup()
    await joinGame(ctx(room, 'alice', { gameId: 'g' }))
    expect(await cancelGame(ctx(room, 'alice', { gameId: 'g' }, ENV))).toMatchObject({ success: false, code: 'forbidden' })
    expect(room.game('g').status).toBe('open')
  })

  it('cancels, frees every spot, ends chat access, emails players, and stops joins', async () => {
    const room = setup()
    const sent: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: unknown, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)).to[0])
        return new Response(JSON.stringify({ id: 'e' }))
      }),
    )
    for (const p of ['alice', 'bob', 'org']) await joinGame(ctx(room, p, { gameId: 'g' }, {}))

    const r = await cancelGame(ctx(room, 'org', { gameId: 'g' }, ENV))
    expect(r).toMatchObject({ success: true, data: { cancelled: true, playersRemoved: 3, notified: 2 } })
    expect(room.game('g')).toMatchObject({ status: 'cancelled', playerCount: 0 })
    expect(room.rows('registrations', { gameId: 'g' })).toHaveLength(0)
    expect(room.table('team_members').has(chatMemberId('g', 'alice'))).toBe(false)
    expect(sent.sort()).toEqual(['alice@example.com', 'bob@example.com']) // not the organizer

    expect(await joinGame(ctx(room, 'carol', { gameId: 'g' }))).toMatchObject({ success: false, code: 'not_open' })
    // Cancelling twice is harmless.
    expect(await cancelGame(ctx(room, 'org', { gameId: 'g' }, ENV))).toMatchObject({ success: true })
  })

  it('a failed email does not block cancelling', async () => {
    const room = setup()
    await joinGame(ctx(room, 'alice', { gameId: 'g' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await cancelGame(ctx(room, 'org', { gameId: 'g' }, ENV))).toMatchObject({
      success: true,
      data: { cancelled: true, notified: 0 },
    })
    expect(room.game('g').status).toBe('cancelled')
  })
})
