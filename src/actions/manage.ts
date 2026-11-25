/**
 * Organizer-only game management (server actions, RBAC off — so every check
 * that matters is made here):
 *
 *   updateGame({ gameId, patch }) — edit the game's details.
 *     Only editable fields; validated like the create form. Max players can't
 *     go below the highest spot already taken: joins are capped by numbered
 *     spots 1..maxPlayers (src/actions/games.ts), so a taken spot above the new
 *     max would let concurrent joins overbook. Re-checked right after saving in
 *     case a join landed in between; if so, max is raised back to fit.
 *
 *   cancelGame({ gameId }) — status → cancelled (game leaves everyone's map,
 *     joins stop), then remove its registrations + chat memberships, and email
 *     the registered players. Email failures are only logged (same rule as joins).
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Game } from '../lib/games'
import { sendEmail, type EmailEnv } from '../server/email'
import { listRegistrations, oneLine, syncGameCounts } from './games'
import { removeChatMember } from './chat'

type GameData = Game & Record<string, unknown>

const MAX_LEN: Record<string, number> = { title: 80, fieldName: 120, address: 300, cost: 80, notes: 1000 }
const SKILLS = ['casual', 'intermediate', 'competitive']
const SURFACES = ['grass', 'turf', 'indoor']

function fail(error: string, code: string): ActionResult {
  return { success: false, error, code }
}

/** Load the game and require the caller to be its organizer. */
async function requireOrganizer(
  tools: ActionTools,
  params: Record<string, unknown>,
  userId: string,
): Promise<{ ok: true; gameId: string; game: GameData } | { ok: false; result: ActionResult }> {
  const gameId = typeof params.gameId === 'string' && params.gameId.length <= 200 ? params.gameId : ''
  if (!gameId) return { ok: false, result: fail('Missing gameId', 'bad_request') }
  const res = await tools.get<GameData>('games', gameId)
  if (!res.success) return { ok: false, result: fail('Game not found', 'not_found') }
  const game = res.data.record.data
  if (game.organizerId !== userId) {
    return { ok: false, result: fail('Only the organizer can change this game', 'forbidden') }
  }
  return { ok: true, gameId, game }
}

/** Validate an edit; returns the clean patch or an error message. */
export function validatePatch(raw: unknown, now = Date.now()): { patch: Partial<Game> } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Nothing to update' }
  const input = raw as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  for (const key of ['title', 'fieldName', 'address', 'cost', 'notes'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string') return { error: `${key} must be text` }
    const v = (input[key] as string).trim()
    if (v.length > MAX_LEN[key]) return { error: `${key} is too long` }
    if ((key === 'title' || key === 'fieldName') && !v) return { error: `${key} can't be empty` }
    patch[key] = v
  }
  if (input.lat !== undefined || input.lng !== undefined) {
    const lat = Number(input.lat)
    const lng = Number(input.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { error: 'Invalid location' }
    }
    patch.lat = lat
    patch.lng = lng
  }
  if (input.startsAt !== undefined) {
    const t = typeof input.startsAt === 'string' ? Date.parse(input.startsAt) : NaN
    if (!Number.isFinite(t)) return { error: 'Invalid kickoff time' }
    if (t <= now) return { error: 'Kickoff must be in the future' }
    patch.startsAt = new Date(t).toISOString()
  }
  if (input.durationMin !== undefined) {
    const d = Number(input.durationMin)
    if (!Number.isInteger(d) || d < 30 || d > 240) return { error: 'Duration must be 30–240 minutes' }
    patch.durationMin = d
  }
  if (input.maxPlayers !== undefined) {
    const m = Number(input.maxPlayers)
    if (!Number.isInteger(m) || m < 2 || m > 30) return { error: 'Max players must be 2–30' }
    patch.maxPlayers = m
  }
  if (input.skillLevel !== undefined) {
    if (!SKILLS.includes(input.skillLevel as string)) return { error: 'Invalid skill level' }
    patch.skillLevel = input.skillLevel
  }
  if (input.surface !== undefined) {
    if (!SURFACES.includes(input.surface as string)) return { error: 'Invalid surface' }
    patch.surface = input.surface
  }
  if (Object.keys(patch).length === 0) return { error: 'Nothing to update' }
  return { patch: patch as Partial<Game> }
}

/** Highest numbered spot held in this game (0 if none). */
async function highestSlot(tools: ActionTools, gameId: string): Promise<{ count: number; top: number }> {
  const regs = await listRegistrations(tools, gameId)
  return { count: regs.length, top: regs.reduce((m, r) => Math.max(m, Number(r.data.slot) || 0), 0) }
}

export const updateGame: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const access = await requireOrganizer(tools, params, userId)
  if (!access.ok) return access.result
  const { gameId, game } = access
  if (game.status === 'cancelled' || game.status === 'past') {
    return fail('A cancelled or finished game can’t be edited', 'closed')
  }

  const checked = validatePatch(params.patch)
  if ('error' in checked) return fail(checked.error, 'invalid')
  const patch = checked.patch

  if (patch.maxPlayers !== undefined) {
    const { count, top } = await highestSlot(tools, gameId)
    if (patch.maxPlayers < top) {
      return fail(
        count === top
          ? `${count} players have already joined — max players can’t be lower than ${count}`
          : `Spots up to #${top} are taken — max players can’t be lower than ${top}`,
        'too_low',
      )
    }
  }

  const res = await tools.update<GameData>('games', gameId, patch as Partial<GameData>)
  if (!res.success) {
    console.error(`[manage] update ${gameId} failed: ${res.error}`)
    return fail('Could not save the changes', 'error')
  }

  let note: string | undefined
  if (patch.maxPlayers !== undefined) {
    // A join may have claimed a higher spot between our check and the save.
    const { top } = await highestSlot(tools, gameId)
    if (top > patch.maxPlayers) {
      await tools.update<GameData>('games', gameId, { maxPlayers: top })
      note = `Someone just joined — max players kept at ${top}`
    }
  }
  const playerCount = await syncGameCounts(tools, gameId) // open/full may change with max
  return { success: true, data: { updated: true, playerCount, ...(note ? { note } : {}) } }
}

export const cancelGame: ActionHandler<Env> = async ({ userId, params, tools, env }) => {
  const access = await requireOrganizer(tools, params, userId)
  if (!access.ok) return access.result
  const { gameId, game } = access
  if (game.status === 'cancelled') return { success: true, data: { cancelled: true, alreadyCancelled: true } }
  if (game.status === 'past') return fail('This game is already over', 'past')

  // 1. Status first: the game leaves the map and joinGame refuses it from now on.
  const res = await tools.update<GameData>('games', gameId, { status: 'cancelled' })
  if (!res.success) {
    console.error(`[manage] cancel ${gameId} failed: ${res.error}`)
    return fail('Could not cancel the game', 'error')
  }

  // 2. Clear registrations + chat access. Repeat once more to catch a join
  //    that passed its status check just before the cancel.
  const players: { userId: string; userName?: string }[] = []
  for (let round = 0; round < 3; round++) {
    const regs = await listRegistrations(tools, gameId)
    if (regs.length === 0) break
    for (const r of regs) {
      players.push({ userId: String(r.data.userId), userName: r.data.userName as string | undefined })
      await tools.remove('registrations', r.recordId)
      if (r.data.userId !== game.organizerId) await removeChatMember(tools, gameId, String(r.data.userId))
    }
  }
  await tools.update<GameData>('games', gameId, { playerCount: 0 })

  // 3. Tell the registered players (not the organizer). Failures are logged only.
  const notified = await notifyCancelled(env, tools, game, players)
  return { success: true, data: { cancelled: true, playersRemoved: players.length, notified } }
}

async function notifyCancelled(
  env: EmailEnv,
  tools: ActionTools,
  game: GameData,
  players: { userId: string }[],
): Promise<number> {
  let sent = 0
  const when = new Date(game.startsAt).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  for (const p of players) {
    if (p.userId === game.organizerId) continue
    try {
      const u = await tools.get<{ email?: string }>('users', p.userId)
      const to = u.success ? u.data.record.data.email : undefined
      if (!to) continue
      const r = await sendEmail(env, {
        to,
        subject: `"${oneLine(game.title)}" was cancelled`,
        text:
          `The organizer cancelled "${oneLine(game.title)}" at ${oneLine(game.fieldName)} (${when} Pacific).\n` +
          `Your spot has been released — find another game: https://pickup-soccer.app.space/home`,
      })
      if (r.ok) sent++
    } catch (err) {
      console.error(`[manage] cancel notice to ${p.userId} failed: ${String(err)}`)
    }
  }
  return sent
}
