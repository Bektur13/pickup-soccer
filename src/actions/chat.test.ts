/**
 * Per-game chat: who can post (server actions, against FakeRoom) and who can
 * read (the SDK's own `canRead` from deepspace/worker, applied to our real
 * `messages` schema with team membership taken from the fake room).
 */

import { describe, expect, it } from 'vitest'
import { canRead, checkFieldPermissions } from 'deepspace/worker'
import { ensureChatAccess, postGameMessage } from './chat'
import { joinGame, leaveGame } from './games'
import { gameMessagesSchema, MESSAGE_MAX_LENGTH } from '../schemas/chat-schema'
import { ctx, FakeRoom, type Row } from './__tests__/fake-room'

function setup() {
  const room = new FakeRoom()
  room.addGame('g', { organizerId: 'org' })
  room.addGame('other', { organizerId: 'someoneElse' })
  return room
}

async function post(room: FakeRoom, userId: string, content: string, gameId = 'g') {
  return postGameMessage(ctx(room, userId, { gameId, content }))
}

/** The RecordRoom's read decision for `userId` (role) on a stored message. */
function readable(room: FakeRoom, msg: Row, userId: string | null, role = 'member') {
  const permCtx = {
    isTeamMember: (teamId: string, uid: string) =>
      room.rows('team_members', { teamId, userId: uid }).some((r) => r.data.status !== 'removed'),
  }
  return canRead(gameMessagesSchema, role, { ...msg }, userId as string, permCtx)
}

describe('postGameMessage', () => {
  it('lets the organizer and registered players post; author is the caller', async () => {
    const room = setup()
    await joinGame(ctx(room, 'alice', { gameId: 'g' }))

    expect(await post(room, 'org', 'Bring water!')).toMatchObject({ success: true })
    expect(await post(room, 'alice', 'See you there')).toMatchObject({ success: true })

    const msgs = room.rows('messages', { channelId: 'g' })
    expect(msgs.map((m) => [m.data.authorId, m.data.content])).toEqual([
      ['org', 'Bring water!'],
      ['alice', 'See you there'],
    ])
  })

  it('refuses outsiders and players who left', async () => {
    const room = setup()
    expect(await post(room, 'carol', 'hi')).toMatchObject({ success: false, code: 'not_member' })

    await joinGame(ctx(room, 'bob', { gameId: 'g' }))
    await leaveGame(ctx(room, 'bob', { gameId: 'g' }))
    expect(await post(room, 'bob', 'still here?')).toMatchObject({ success: false, code: 'not_member' })

    expect(room.rows('messages')).toHaveLength(0)
  })

  it('validates the text and closed games', async () => {
    const room = setup()
    expect(await post(room, 'org', '   ')).toMatchObject({ success: false, code: 'bad_request' })
    expect(await post(room, 'org', 'x'.repeat(MESSAGE_MAX_LENGTH + 1))).toMatchObject({ code: 'too_long' })
    room.game('g').status = 'cancelled'
    expect(await post(room, 'org', 'hello')).toMatchObject({ success: false, code: 'closed' })
  })

  it('only allows replies to a message in the same game', async () => {
    const room = setup()
    const elsewhere = await post(room, 'someoneElse', 'other game', 'other')
    const foreignId = elsewhere.success ? (elsewhere.data as { messageId: string }).messageId : ''
    const reply = await postGameMessage(
      ctx(room, 'org', { gameId: 'g', content: 'reply', parentMessageId: foreignId }),
    )
    expect(reply).toMatchObject({ success: false, code: 'bad_request' })
  })
})

describe('ensureChatAccess', () => {
  it('gives the organizer membership, refuses outsiders', async () => {
    const room = setup()
    expect(await ensureChatAccess(ctx(room, 'org', { gameId: 'g' }))).toMatchObject({
      success: true,
      data: { channelId: 'g' },
    })
    expect(room.rows('team_members', { teamId: 'g', userId: 'org' })).toHaveLength(1)

    expect(await ensureChatAccess(ctx(room, 'carol', { gameId: 'g' }))).toMatchObject({
      success: false,
      code: 'not_member',
    })
    expect(room.rows('team_members', { userId: 'carol' })).toHaveLength(0)
  })

  it('repairs a missing membership row for a registered player', async () => {
    const room = setup()
    await joinGame(ctx(room, 'alice', { gameId: 'g' }))
    room.table('team_members').clear()
    expect((await ensureChatAccess(ctx(room, 'alice', { gameId: 'g' }))).success).toBe(true)
    expect(room.rows('team_members', { teamId: 'g', userId: 'alice' })).toHaveLength(1)
  })
})

describe('message privacy (SDK canRead on our schema)', () => {
  it('only members, the organizer, and admins can read a game’s messages', async () => {
    const room = setup()
    await joinGame(ctx(room, 'alice', { gameId: 'g' }))
    await joinGame(ctx(room, 'bob', { gameId: 'g' }))
    await ensureChatAccess(ctx(room, 'org', { gameId: 'g' }))
    await post(room, 'alice', 'secret plan')
    const [msg] = room.rows('messages', { channelId: 'g' })

    expect(readable(room, msg, 'alice')).toBe(true) // author
    expect(readable(room, msg, 'bob')).toBe(true) // registered player
    expect(readable(room, msg, 'org')).toBe(true) // organizer
    expect(readable(room, msg, 'carol')).toBe(false) // signed in, not in the game
    expect(readable(room, msg, null, 'viewer')).toBe(false) // signed out
    expect(readable(room, msg, 'anyone', 'admin')).toBe(true) // moderation

    await leaveGame(ctx(room, 'bob', { gameId: 'g' }))
    expect(readable(room, msg, 'bob')).toBe(false) // left the game
  })

  it("an author can't move their message into another game", () => {
    const existing = { channelId: 'g', content: 'hi', authorId: 'alice' }
    expect(
      checkFieldPermissions(gameMessagesSchema, 'member', { ...existing, channelId: 'other' }, existing),
    ).toMatch(/cannot modify field 'channelId'/)
    expect(
      checkFieldPermissions(gameMessagesSchema, 'member', { content: 'edited', edited: true }, existing),
    ).toBeNull()
  })
})
