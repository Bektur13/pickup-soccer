/**
 * Scheduled-job logic, run by the CronRoom via src/cron.ts. Uses the cron
 * context's `records` API (buildCronContext, deepspace/worker): it runs as the
 * app owner with RBAC off, returns data directly, and THROWS on failure.
 * Docs: https://docs.deep.space/guides/scheduled-jobs
 */

import type { CronContext } from 'deepspace/worker'
import type { Game } from '../lib/games'
import { sendEmail, type EmailEnv, type EmailMessage, type SendResult } from './email'

type Records = CronContext['records']
type Envelope<T> = { recordId: string; data: T }

/** Reminders go out this long before kickoff. */
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000
/** Upper bound on games/registrations read per run (maxPlayers ≤ 30). */
const PAGE = 500

async function query<T>(records: Records, collection: string, where: Record<string, unknown>, limit = PAGE) {
  return (await records.query(collection, { where, limit })) as Envelope<T>[]
}

/** Games still on the map (open or full) — `where` is equality-only. */
async function liveGames(records: Records): Promise<Envelope<Game>[]> {
  const [open, full] = await Promise.all([
    query<Game>(records, 'games', { status: 'open' }),
    query<Game>(records, 'games', { status: 'full' }),
  ])
  return [...open, ...full]
}

function pacificTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function reminderEmail(to: string, game: Game): EmailMessage {
  const where = game.address ? `${game.fieldName}, ${game.address}` : game.fieldName
  return {
    to,
    subject: `Reminder: "${game.title}" kicks off in 2 hours`,
    text:
      `Reminder: "${game.title}" kicks off at ${pacificTime(game.startsAt)} (Pacific) at ${where}.\n` +
      `Spots taken: ${game.playerCount ?? 0} / ${game.maxPlayers}` +
      (game.cost ? `\nCost: ${game.cost}` : '') +
      `\n\nOpen the map: https://pickup-soccer.app.space/home`,
  }
}

export interface ReminderRunSummary {
  dueGames: number
  sent: number
  failed: number
  /** Already claimed by an earlier (or overlapping) run — not sent again. */
  alreadyClaimed: number
}

/**
 * `send-reminders`: email every registered player of each game whose kickoff is
 * within the next 2 hours — at most once per (game, player).
 *
 * Never twice: before sending, claim the pair by creating a `reminders_sent`
 * row. `uniqueOn: ['gameId','userId']` makes that create a single atomic
 * RecordRoom write that fails ("Duplicate: …") for every run but the first,
 * including runs that overlap. Only the claiming run sends. A failed send is
 * logged and marked `failed` but NOT retried — a retry could double-send if
 * Resend actually delivered before erroring.
 */
export async function sendDueReminders(
  records: Records,
  env: EmailEnv,
  now: number = Date.now(),
  send: (env: EmailEnv, msg: EmailMessage) => Promise<SendResult> = sendEmail,
): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { dueGames: 0, sent: 0, failed: 0, alreadyClaimed: 0 }

  const due = (await liveGames(records)).filter((g) => {
    const start = Date.parse(g.data.startsAt)
    return start > now && start - now <= REMINDER_LEAD_MS
  })
  summary.dueGames = due.length

  for (const game of due) {
    const regs = await query<{ userId: string }>(records, 'registrations', { gameId: game.recordId }, 100)

    for (const reg of regs) {
      const userId = reg.data.userId
      let claimId: string
      try {
        const created = (await records.create('reminders_sent', {
          gameId: game.recordId,
          userId,
          status: 'claimed',
        })) as { recordId: string }
        claimId = created.recordId
      } catch (err) {
        if (String(err).includes('Duplicate')) {
          summary.alreadyClaimed++
          continue
        }
        console.error(`[reminders] claim failed for ${game.recordId}/${userId}: ${String(err)}`)
        continue
      }

      // This run owns the claim: send exactly one email.
      let status: 'sent' | 'failed' = 'failed'
      try {
        const [user] = await query<{ email?: string }>(records, 'users', { recordId: userId }, 1)
        const to = user?.data.email
        if (!to) {
          console.error(`[reminders] no email on file for ${userId}; not sent`)
        } else {
          const result = await send(env, reminderEmail(to, game.data))
          status = result.ok ? 'sent' : 'failed'
        }
      } catch (err) {
        console.error(`[reminders] send failed for ${game.recordId}/${userId}: ${String(err)}`)
      }
      if (status === 'sent') summary.sent++
      else summary.failed++

      try {
        await records.update('reminders_sent', claimId, { status })
      } catch (err) {
        // The claim row still exists, so this pair is never retried either way.
        console.warn(`[reminders] could not record status for ${claimId}: ${String(err)}`)
      }
    }
  }
  return summary
}

/**
 * `mark-past-games`: open/full games whose kickoff + duration has passed
 * become `past` (server-only status). Idempotent — re-running changes nothing.
 */
export async function markPastGames(records: Records, now: number = Date.now()): Promise<number> {
  let marked = 0
  for (const game of await liveGames(records)) {
    const end = Date.parse(game.data.startsAt) + (game.data.durationMin ?? 0) * 60_000
    if (!Number.isFinite(end) || end >= now) continue
    try {
      await records.update('games', game.recordId, { status: 'past' })
      marked++
    } catch (err) {
      console.error(`[mark-past] ${game.recordId}: ${String(err)}`)
    }
  }
  return marked
}
