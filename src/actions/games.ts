/**
 * joinGame / leaveGame — server actions (POST /api/actions/joinGame|leaveGame,
 * body `{ gameId }`). They run as the app (RBAC off), so they're the only code
 * allowed to write registrations and games.playerCount/status.
 *
 * ── Why this is race-safe ────────────────────────────────────────────────
 * The unit of atomicity in DeepSpace is ONE record write. The RecordRoom is a
 * single Durable Object; it runs one request's synchronous code to completion
 * before starting another, and a write (`putRecord` in
 * node_modules/deepspace/dist/worker.js) is fully synchronous: it checks
 * `uniqueOn` with a SELECT and then INSERTs, with no `await` in between.
 * Docs: https://docs.deep.space/concepts/realtime-sync ("Writes are
 * serialized inside the DO").
 *
 * A server action is NOT atomic as a whole: each `tools.*` call is a separate
 * request to the DO (src/server/action-routes.ts → stub.fetch), so other
 * users' requests can run between them. So the decisions that must never be
 * wrong are each made by a single write:
 *   - one registration per user per game → fixed recordId
 *     `${gameId}__${userId}` (registrationId()).
 *   - never more than maxPlayers → each registration claims a slot in
 *     1..maxPlayers; `uniqueOn: ['gameId','slot']` refuses a duplicate slot.
 *     Two users racing for the last slot both try the same number; the second
 *     write fails with "Duplicate: …", re-reads, finds no free slot → "full".
 * playerCount/status are then recomputed from the real registration count
 * (syncGameCounts), re-checking after each write so they converge.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Game } from '../lib/games'
import { registrationId } from '../schemas/registrations-schema'
import { addChatMember, removeChatMember } from './chat'

interface Registration extends Record<string, unknown> {
  gameId: string
  userId: string
  userName?: string
  slot: number
}

type GameData = Game & Record<string, unknown>

/** Retries when another join takes the slot we picked. */
const MAX_CLAIM_ATTEMPTS = 5
/** Read-after-write rounds for playerCount/status. */
const MAX_SYNC_ROUNDS = 4
/** maxPlayers is capped at 30, so one page holds every registration. */
const REGISTRATIONS_PAGE = 100

function fail(error: string, code: string): ActionResult {
  return { success: false, error, code }
}

function gameIdParam(params: Record<string, unknown>): string | null {
  const id = params.gameId
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null
}

async function listRegistrations(tools: ActionTools, gameId: string) {
  const res = await tools.query<Registration>('registrations', {
    where: { gameId },
    limit: REGISTRATIONS_PAGE,
  })
  if (!res.success) throw new Error(`registrations query failed: ${res.error}`)
  return res.data.records
}

/** Display name for the roster — the name only, never the email. */
async function lookupUserName(tools: ActionTools, userId: string): Promise<string> {
  const res = await tools.get<{ name?: string }>('users', userId)
  const name = res.success ? res.data.record.data.name : undefined
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Player'
}

/**
 * Set games.playerCount to the real registration count and status to
 * open/full to match. Cancelled/past games keep their status. Re-reads after
 * each write: the last action to finish always leaves the values correct.
 */
async function syncGameCounts(tools: ActionTools, gameId: string): Promise<number | null> {
  for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
    const [regs, gameRes] = await Promise.all([
      listRegistrations(tools, gameId),
      tools.get<GameData>('games', gameId),
    ])
    if (!gameRes.success) return null
    const game = gameRes.data.record.data
    const count = regs.length
    let status = game.status
    if (status === 'open' || status === 'full') status = count >= game.maxPlayers ? 'full' : 'open'
    if (game.playerCount === count && game.status === status) return count

    const upd = await tools.update<GameData>('games', gameId, { playerCount: count, status })
    if (!upd.success) {
      console.error(`[games] playerCount sync failed for ${gameId}: ${upd.error}`)
      return null
    }
  }
  console.warn(`[games] playerCount for ${gameId} still changing after ${MAX_SYNC_ROUNDS} rounds`)
  return null
}

export const joinGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = gameIdParam(params)
  if (!gameId) return fail('Missing gameId', 'bad_request')

  const gameRes = await tools.get<GameData>('games', gameId)
  if (!gameRes.success) return fail('Game not found', 'not_found')
  const game = gameRes.data.record.data

  if (game.status === 'full') return fail('This game is full', 'full')
  if (game.status !== 'open') return fail('This game is not open for joining', 'not_open')
  if (!(Date.parse(game.startsAt) > Date.now())) return fail('This game has already started', 'started')

  const regId = registrationId(gameId, userId)
  const existing = await tools.get<Registration>('registrations', regId)
  if (existing.success) {
    return { success: true, data: { joined: true, alreadyJoined: true, playerCount: game.playerCount } }
  }

  const userName = await lookupUserName(tools, userId)

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    const regs = await listRegistrations(tools, gameId)
    // A concurrent request from this same user (double click) got here first.
    if (regs.some((r) => r.recordId === regId)) {
      const playerCount = await syncGameCounts(tools, gameId)
      return { success: true, data: { joined: true, alreadyJoined: true, playerCount } }
    }

    const taken = new Set(regs.map((r) => r.data.slot))
    let slot = 0
    for (let s = 1; s <= game.maxPlayers; s++) {
      if (!taken.has(s)) {
        slot = s
        break
      }
    }
    if (slot === 0) {
      await syncGameCounts(tools, gameId) // make sure status shows `full`
      return fail('This game is full', 'full')
    }

    // The atomic step: succeeds only if no other registration holds this slot.
    const created = await tools.create<Registration>(
      'registrations',
      { gameId, userId, userName, slot },
      regId,
    )
    if (created.success) {
      // Chat access for the new player. A separate write: if it fails, the
      // join still stands and ensureChatAccess repairs it when chat opens.
      const member = await addChatMember(tools, gameId, userId)
      if (!member.success) console.error(`[games] chat membership for ${gameId}/${userId}: ${member.error}`)
      const playerCount = await syncGameCounts(tools, gameId)
      return { success: true, data: { joined: true, alreadyJoined: false, playerCount } }
    }
    if (!created.error.startsWith('Duplicate:')) {
      console.error(`[games] join ${gameId} by ${userId} failed: ${created.error}`)
      return fail('Could not join the game', 'error')
    }
    // Someone else took this slot between our read and write — try again.
  }

  return fail('Lots of people are joining right now — please try again', 'busy')
}

export const leaveGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const gameId = gameIdParam(params)
  if (!gameId) return fail('Missing gameId', 'bad_request')

  const gameRes = await tools.get<GameData>('games', gameId)
  if (gameRes.success && gameRes.data.record.data.status === 'past') {
    return fail('This game is already over', 'past')
  }

  const regId = registrationId(gameId, userId)
  const existing = await tools.get<Registration>('registrations', regId)
  if (!existing.success) {
    return { success: true, data: { left: false, notJoined: true } }
  }

  const removed = await tools.remove('registrations', regId)
  if (!removed.success) {
    console.error(`[games] leave ${gameId} by ${userId} failed: ${removed.error}`)
    return fail('Could not leave the game', 'error')
  }

  // Leaving also ends chat access — except for the organizer, who keeps it.
  const isOrganizer = gameRes.success && gameRes.data.record.data.organizerId === userId
  if (!isOrganizer) {
    const member = await removeChatMember(tools, gameId, userId)
    if (!member.success && member.error !== 'Record not found') {
      console.error(`[games] chat membership removal for ${gameId}/${userId}: ${member.error}`)
    }
  }

  const playerCount = gameRes.success ? await syncGameCounts(tools, gameId) : null
  return { success: true, data: { left: true, playerCount } }
}
