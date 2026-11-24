/**
 * Registrations — one record per (game, player). Written ONLY by the
 * joinGame/leaveGame server actions (src/actions/games.ts); every browser role
 * has create/update/delete off.
 *
 * Two invariants are enforced by single, atomic RecordRoom writes (see the
 * comment at the top of src/actions/games.ts for why that's the unit of
 * atomicity):
 *   - one registration per user per game: the recordId is `${gameId}__${userId}`
 *     (primary key), see registrationId().
 *   - at most `maxPlayers` per game: each registration claims a `slot` in
 *     1..maxPlayers, and `uniqueOn: ['gameId', 'slot']` refuses a second row
 *     with the same slot ("Duplicate: …", dist/worker.js putRecord).
 *
 * Readable by everyone: the roster shows names only (never email/phone).
 */

import type { CollectionSchema } from 'deepspace/schema'

/** The fixed record id for a user's registration in a game. */
export function registrationId(gameId: string, userId: string): string {
  return `${gameId}__${userId}`
}

const NO_BROWSER_WRITES = { create: false, update: false, delete: false } as const

export const registrationsSchema: CollectionSchema = {
  name: 'registrations',
  ownerField: 'userId',
  uniqueOn: ['gameId', 'slot'],
  columns: [
    { name: 'gameId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'userName', storage: 'text', interpretation: 'plain', maxLength: 80 },
    { name: 'slot', storage: 'number', interpretation: 'plain', required: true },
  ],
  permissions: {
    '*': { read: true, ...NO_BROWSER_WRITES },
    viewer: { read: true, ...NO_BROWSER_WRITES },
    member: { read: true, ...NO_BROWSER_WRITES },
    admin: { read: true, ...NO_BROWSER_WRITES },
  },
}
