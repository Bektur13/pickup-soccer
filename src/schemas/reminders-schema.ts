/**
 * reminders_sent — one row per (game, player) whose 2-hour reminder has been
 * claimed. Written only by the `send-reminders` scheduled job (src/cron.ts).
 *
 * "Never sent twice" rests on `uniqueOn: ['gameId', 'userId']`: the job
 * creates this row BEFORE sending, and the RecordRoom refuses a second row for
 * the same pair in one atomic write ("Duplicate: …", dist/worker.js putRecord).
 * Only the run that created the row sends the email — even if two runs overlap.
 *
 * `userId` is NOT userBound: the job runs as the app owner, and userBound would
 * stamp the owner's id instead of the player's.
 */

import type { CollectionSchema } from 'deepspace/schema'

const NO_ACCESS = { read: false, create: false, update: false, delete: false } as const

export const remindersSentSchema: CollectionSchema = {
  name: 'reminders_sent',
  uniqueOn: ['gameId', 'userId'],
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['claimed', 'sent', 'failed'] },
      default: 'claimed',
    },
  ],
  permissions: {
    '*': NO_ACCESS,
    viewer: NO_ACCESS,
    member: NO_ACCESS,
    admin: NO_ACCESS,
  },
}
