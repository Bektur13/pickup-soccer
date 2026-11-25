import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markPastGames, sendDueReminders, REMINDER_LEAD_MS } from './scheduled'
import type { EmailEnv, EmailMessage, SendResult } from './email'
import { joinGame, leaveGame } from '../actions/games'
import { ctx, cronRecordsFor, FakeRoom } from '../actions/__tests__/fake-room'

const MIN = 60_000
const ENV: EmailEnv = { RESEND_API_KEY: 'fake-resend-key-for-tests' }

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

/** A room with a game kicking off in `inMin` minutes and some registered players. */
async function roomWithGame(inMin: number, players: string[] = ['alice', 'bob']) {
  const room = new FakeRoom()
  // Joins happen while the game is still days away (joinGame refuses started games).
  room.addGame('g', {
    organizerId: 'org',
    title: 'Saturday 7v7',
    fieldName: 'Crossroads Park',
    maxPlayers: 10,
    startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  })
  for (const p of ['org', ...players]) {
    room.table('users').set(p, { recordId: p, createdBy: p, data: { name: p, email: `${p}@example.com` } })
  }
  for (const p of players) await joinGame(ctx(room, p, { gameId: 'g' }))
  room.game('g').startsAt = new Date(Date.now() + inMin * MIN).toISOString()
  return room
}

function fakeSend(result: SendResult = { ok: true, id: 'e' }) {
  return vi.fn(async (_env: EmailEnv, _msg: EmailMessage) => result)
}

const recipients = (send: ReturnType<typeof fakeSend>) => send.mock.calls.map((c) => c[1].to).sort()

describe('send-reminders', () => {
  it('emails each registered player once when kickoff is within 2 hours', async () => {
    const room = await roomWithGame(110)
    const send = fakeSend()

    const s = await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)

    expect(recipients(send)).toEqual(['alice@example.com', 'bob@example.com'])
    expect(send.mock.calls[0][1].subject).toBe('Reminder: "Saturday 7v7" kicks off in 2 hours')
    expect(s).toMatchObject({ dueGames: 1, sent: 2, failed: 0 })
    expect(room.rows('reminders_sent', { gameId: 'g' }).map((r) => r.data.status)).toEqual(['sent', 'sent'])
  })

  it('never sends twice: later runs skip players already reminded', async () => {
    const room = await roomWithGame(110)
    const send = fakeSend()
    for (let i = 0; i < 5; i++) await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('never sends twice even when runs overlap (×20)', async () => {
    for (let run = 0; run < 20; run++) {
      const room = await roomWithGame(110, ['alice', 'bob', 'carol'])
      const send = fakeSend()
      await Promise.all(
        Array.from({ length: 4 }, () => sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)),
      )
      expect(recipients(send)).toEqual(['alice@example.com', 'bob@example.com', 'carol@example.com'])
      expect(room.rows('reminders_sent', { gameId: 'g' })).toHaveLength(3)
    }
  }, 30_000)

  it('a player who joins after the first reminder run still gets exactly one', async () => {
    const room = await roomWithGame(110, ['alice'])
    const send = fakeSend()
    await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)

    // Late joiner (registration written directly: joinGame is fine 110 min out too).
    await joinGame(ctx(room, 'dave', { gameId: 'g' }))
    room.table('users').set('dave', { recordId: 'dave', createdBy: 'dave', data: { email: 'dave@example.com' } })
    await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)
    await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)

    expect(recipients(send)).toEqual(['alice@example.com', 'dave@example.com'])
  })

  it('skips games outside the window and players who left', async () => {
    const send = fakeSend()
    const far = await roomWithGame(2 * 60 + 10) // 2h10m away: not yet
    await sendDueReminders(cronRecordsFor(far), ENV, Date.now(), send)
    const started = await roomWithGame(-5) // already kicked off
    await sendDueReminders(cronRecordsFor(started), ENV, Date.now(), send)
    expect(send).not.toHaveBeenCalled()

    const room = await roomWithGame(3 * 24 * 60, ['alice', 'bob'])
    await leaveGame(ctx(room, 'bob', { gameId: 'g' }))
    room.game('g').startsAt = new Date(Date.now() + REMINDER_LEAD_MS - 5 * MIN).toISOString()
    await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), send)
    expect(recipients(send)).toEqual(['alice@example.com'])
  })

  it('a failed send is logged, marked failed, and not retried', async () => {
    const room = await roomWithGame(110, ['alice'])
    const failing = fakeSend({ ok: false, error: 'Resend 500' })
    const s = await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), failing)
    expect(s).toMatchObject({ sent: 0, failed: 1 })
    expect(room.rows('reminders_sent', { userId: 'alice' })[0].data.status).toBe('failed')

    const ok = fakeSend()
    await sendDueReminders(cronRecordsFor(room), ENV, Date.now(), ok)
    expect(ok).not.toHaveBeenCalled()
  })
})

describe('mark-past-games', () => {
  it('marks finished games past; leaves upcoming, in-progress and cancelled ones', async () => {
    const room = new FakeRoom()
    const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString()
    room.addGame('finished', { startsAt: ago(120), durationMin: 90 })
    room.addGame('fullFinished', { startsAt: ago(200), durationMin: 90, status: 'full' })
    room.addGame('inProgress', { startsAt: ago(30), durationMin: 90 })
    room.addGame('upcoming', { startsAt: new Date(Date.now() + 60 * MIN).toISOString() })
    room.addGame('cancelled', { startsAt: ago(500), status: 'cancelled' })

    expect(await markPastGames(cronRecordsFor(room))).toBe(2)
    expect(room.game('finished').status).toBe('past')
    expect(room.game('fullFinished').status).toBe('past')
    expect(room.game('inProgress').status).toBe('open')
    expect(room.game('upcoming').status).toBe('open')
    expect(room.game('cancelled').status).toBe('cancelled')

    expect(await markPastGames(cronRecordsFor(room))).toBe(0) // idempotent
  })
})
