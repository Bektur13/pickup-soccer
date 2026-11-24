/**
 * Private per-game chat on DeepSpace messaging.
 *
 * We register DeepSpace's own `messages` schema (MESSAGES_SCHEMA, the one the
 * `useMessages(channelId)` hook reads) with private permissions. A game's chat
 * channel id IS the game id.
 *
 * Who can read a message — enforced in the RecordRoom on every read and every
 * live broadcast (dist/worker.js checkPermissionLevel 'team', broadcastChange):
 *   - its author (ownerField authorId),
 *   - anyone with an active `team_members` row { teamId: <gameId>, userId }
 *     (teamField 'channelId') — registered players and the organizer,
 *   - admins (moderation).
 * Signed-out visitors and everyone else receive nothing.
 *
 * Who can post: nobody directly from the browser — `create` is a plain yes/no
 * per role and can't express "members of this game only". Posting goes through
 * the `postGameMessage` server action (src/actions/chat.ts), which checks
 * membership. Authors may edit/soft-delete their own messages, but only the
 * text fields (writableFields), so a message can't be moved to another game.
 *
 * Docs: https://docs.deep.space/guides/messaging (private messaging needs
 * app-enforced row access), https://docs.deep.space/concepts/permissions
 * ('team' level), https://docs.deep.space/sdk-reference/worker/schemas
 * (team_members must declare teamId, userId, status).
 */

import { MESSAGES_SCHEMA, type CollectionSchema } from 'deepspace/schema'

export const MESSAGE_MAX_LENGTH = 2000

const NO_ACCESS = { read: false, create: false, update: false, delete: false } as const

/** One row per (game, chat member). Written only by server actions. */
export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['active', 'removed'] },
      default: 'active',
    },
  ],
  permissions: {
    '*': NO_ACCESS,
    viewer: NO_ACCESS,
    member: NO_ACCESS,
    admin: NO_ACCESS,
  },
}

/** DeepSpace's `messages` schema, made private to each game's members. */
export const gameMessagesSchema: CollectionSchema = {
  ...MESSAGES_SCHEMA,
  columns: MESSAGES_SCHEMA.columns.map((col) => {
    if (col.name === 'channelId') return { ...col, required: true, immutable: true }
    if (col.name === 'content') return { ...col, maxLength: MESSAGE_MAX_LENGTH }
    return col
  }),
  teamField: 'channelId',
  permissions: {
    '*': NO_ACCESS,
    viewer: NO_ACCESS,
    member: {
      read: 'team',
      create: false, // post via the postGameMessage action
      update: 'own',
      delete: false,
      writableFields: ['content', 'edited', 'editedAt', 'deleted'],
    },
    admin: {
      read: true, // moderation
      create: false,
      update: true,
      delete: true,
      writableFields: ['deleted'],
    },
  },
}

/** The fixed record id of a user's chat membership in a game. */
export function chatMemberId(gameId: string, userId: string): string {
  return `${gameId}__${userId}`
}
