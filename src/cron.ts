/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO records each run (`[cron] <task> ok|failed` in
 * `npx deepspace logs --search cron`) and its history.
 * Docs: https://docs.deep.space/guides/scheduled-jobs
 *
 *   send-reminders   every 5 min  — 2-hour kickoff reminder email to each
 *                                   registered player, at most once
 *   mark-past-games  every 15 min — finished games → status `past`
 *
 * Logic lives in src/server/scheduled.ts (unit-tested).
 */

import type { CronTask } from 'deepspace/worker'
import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { markPastGames, sendDueReminders } from './server/scheduled'

export const tasks: CronTask[] = [
  { name: 'send-reminders', intervalMinutes: 5 },
  { name: 'mark-past-games', intervalMinutes: 15 },
]

export async function runTask(name: string, env: Env): Promise<void> {
  // Scope by the immutable app id (the app's RecordRoom), acting as the owner.
  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)

  if (name === 'send-reminders') {
    const s = await sendDueReminders(ctx.records, env)
    if (s.dueGames > 0) {
      console.info(
        `[reminders] games=${s.dueGames} sent=${s.sent} failed=${s.failed} alreadyClaimed=${s.alreadyClaimed}`,
      )
    }
    return
  }
  if (name === 'mark-past-games') {
    const marked = await markPastGames(ctx.records)
    if (marked > 0) console.info(`[mark-past] marked ${marked} game(s) as past`)
    return
  }
  console.warn(`[cron] unknown task ${name}`)
}
