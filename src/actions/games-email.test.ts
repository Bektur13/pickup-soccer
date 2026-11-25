/**
 * Join/leave → organizer email. The rule under test (CLAUDE.md): if the email
 * fails, the join still succeeds — the failure is only logged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { joinGame, leaveGame } from './games'
import { registrationId } from '../schemas/registrations-schema'
import { ctx, FakeRoom } from './__tests__/fake-room'

const ENV = { RESEND_API_KEY: 'fake-resend-key-for-tests' }

function setup() {
  const room = new FakeRoom()
  room.addGame('g', { organizerId: 'org', title: 'Saturday 7v7', maxPlayers: 10 })
  for (const [id, name, email] of [
    ['org', 'Olga', 'olga@example.com'],
    ['alice', 'Alice', 'alice@example.com'],
  ]) {
    room.table('users').set(id, { recordId: id, createdBy: id, data: { name, email } })
  }
  return room
}

let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubResend(impl: () => Promise<Response>) {
  const f = vi.fn(impl)
  vi.stubGlobal('fetch', f)
  return f
}

const sentBodies = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)))

describe('organizer email on join/leave', () => {
  it('emails the organizer when someone joins', async () => {
    const room = setup()
    const f = stubResend(async () => new Response(JSON.stringify({ id: 'e1' }), { status: 200 }))

    const r = await joinGame(ctx(room, 'alice', { gameId: 'g' }, ENV))

    expect(r.success).toBe(true)
    const [body] = sentBodies(f)
    expect(body.to).toEqual(['olga@example.com'])
    expect(body.subject).toBe('Alice joined "Saturday 7v7"')
    expect(body.text).toMatch(/Spots taken: 1 \/ 10/)
  })

  it('Resend returning an error: the join still succeeds, and the error is logged', async () => {
    const room = setup()
    stubResend(async () => new Response(JSON.stringify({ name: 'internal_server_error', message: 'boom' }), { status: 500 }))

    const r = await joinGame(ctx(room, 'alice', { gameId: 'g' }, ENV))

    expect(r).toMatchObject({ success: true, data: { joined: true } })
    expect(room.table('registrations').has(registrationId('g', 'alice'))).toBe(true)
    expect(room.game('g')).toMatchObject({ playerCount: 1 })
    expect(errorLog.mock.calls.flat().join(' ')).toMatch(/\[email\].*Resend 500/)
  })

  it('Resend unreachable / timing out: the join still succeeds', async () => {
    const room = setup()
    stubResend(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await joinGame(ctx(room, 'alice', { gameId: 'g' }, ENV))).toMatchObject({ success: true })
    expect(errorLog.mock.calls.flat().join(' ')).toMatch(/\[email\].*TimeoutError/)
  })

  it('no RESEND_API_KEY secret: the join still succeeds, nothing is sent', async () => {
    const room = setup()
    const f = stubResend(async () => new Response('{}'))
    expect(await joinGame(ctx(room, 'alice', { gameId: 'g' }, {}))).toMatchObject({ success: true })
    expect(f).not.toHaveBeenCalled()
  })

  it('no email when the organizer joins their own game', async () => {
    const room = setup()
    const f = stubResend(async () => new Response(JSON.stringify({ id: 'e1' })))
    expect((await joinGame(ctx(room, 'org', { gameId: 'g' }, ENV))).success).toBe(true)
    expect(f).not.toHaveBeenCalled()
  })

  it('emails the organizer when someone leaves; a failed email doesn’t block leaving', async () => {
    const room = setup()
    stubResend(async () => new Response(JSON.stringify({ id: 'e1' })))
    await joinGame(ctx(room, 'alice', { gameId: 'g' }, ENV))

    const f = stubResend(async () => new Response('{}', { status: 500 }))
    const r = await leaveGame(ctx(room, 'alice', { gameId: 'g' }, ENV))
    expect(r).toMatchObject({ success: true, data: { left: true } })
    expect(sentBodies(f)[0].subject).toBe('Alice left "Saturday 7v7"')
    expect(room.game('g')).toMatchObject({ playerCount: 0 })
  })
})
