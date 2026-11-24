/**
 * Per-game chat actions (POST /api/actions/<name>). Chat access = the game's
 * organizer or a registered player. Reading is enforced by the RecordRoom
 * through `team_members` (see src/schemas/chat-schema.ts); these actions keep
 * that membership in step with registrations and are the only way to post.
 *
 *   ensureChatAccess({ gameId })                    → { channelId }
 *     Call before showing the chat. Adds the caller's team_members row if
 *     they're entitled to one (covers the organizer, and repairs a missing
 *     row for a registered player).
 *
 *   postGameMessage({ gameId, content, parentMessageId? }) → { messageId }
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Game } from '../lib/games'
import { registrationId } from '../schemas/registrations-schema'
import { chatMemberId, MESSAGE_MAX_LENGTH } from '../schemas/chat-schema'

type GameData = Game & Record<string, unknown>

function fail(error: string, code: string): ActionResult {
  return { success: false, error, code }
}

function stringParam(params: Record<string, unknown>, key: string, max = 200): string | null {
  const v = params[key]
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
}

/** Add (or re-activate) the user's chat membership for a game. Idempotent. */
export async function addChatMember(tools: ActionTools, gameId: string, userId: string) {
  return tools.create('team_members', { teamId: gameId, status: 'active' }, chatMemberId(gameId, userId))
}

/** Remove the user's chat membership for a game (no-op if absent). */
export async function removeChatMember(tools: ActionTools, gameId: string, userId: string) {
  return tools.remove('team_members', chatMemberId(gameId, userId))
}

/**
 * Is `userId` the organizer of, or registered in, this game? If so, make sure
 * their membership row exists and return the game.
 */
async function requireChatAccess(
  tools: ActionTools,
  gameId: string,
  userId: string,
): Promise<{ ok: true; game: GameData } | { ok: false; result: ActionResult }> {
  const gameRes = await tools.get<GameData>('games', gameId)
  if (!gameRes.success) return { ok: false, result: fail('Game not found', 'not_found') }
  const game = gameRes.data.record.data

  const isOrganizer = game.organizerId === userId
  const isRegistered =
    isOrganizer || (await tools.get('registrations', registrationId(gameId, userId))).success
  if (!isOrganizer && !isRegistered) {
    return { ok: false, result: fail('Join this game to use its chat', 'not_member') }
  }

  const added = await addChatMember(tools, gameId, userId)
  if (!added.success) {
    console.error(`[chat] membership upsert failed for ${gameId}/${userId}: ${added.error}`)
    return { ok: false, result: fail('Could not open the chat', 'error') }
  }
  return { ok: true, game }
}

export const ensureChatAccess: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = stringParam(params, 'gameId')
  if (!gameId) return fail('Missing gameId', 'bad_request')
  const access = await requireChatAccess(tools, gameId, userId)
  if (!access.ok) return access.result
  return { success: true, data: { channelId: gameId } }
}

export const postGameMessage: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = stringParam(params, 'gameId')
  if (!gameId) return fail('Missing gameId', 'bad_request')

  const raw = params.content
  const content = typeof raw === 'string' ? raw.trim() : ''
  if (!content) return fail('Message is empty', 'bad_request')
  if (content.length > MESSAGE_MAX_LENGTH) {
    return fail(`Message is longer than ${MESSAGE_MAX_LENGTH} characters`, 'too_long')
  }

  const access = await requireChatAccess(tools, gameId, userId)
  if (!access.ok) return access.result
  if (access.game.status === 'cancelled' || access.game.status === 'past') {
    return fail('This game’s chat is closed', 'closed')
  }

  const data: Record<string, unknown> = { channelId: gameId, content, edited: false }

  // Optional thread reply: the parent must be a message in this same chat.
  if (params.parentMessageId !== undefined) {
    const parentId = stringParam(params, 'parentMessageId')
    const parent = parentId ? await tools.get<{ channelId: string }>('messages', parentId) : null
    if (!parent?.success || parent.data.record.data.channelId !== gameId) {
      return fail('Reply target not found', 'bad_request')
    }
    data.parentMessageId = parentId
  }

  // authorId is userBound: the RecordRoom stamps the caller's id.
  const created = await tools.create('messages', data)
  if (!created.success) {
    console.error(`[chat] post to ${gameId} by ${userId} failed: ${created.error}`)
    return fail('Could not send the message', 'error')
  }
  return { success: true, data: { messageId: created.data.recordId } }
}
