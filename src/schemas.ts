/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { gamesSchema } from './schemas/games-schema'
import { registrationsSchema } from './schemas/registrations-schema'
import { gameMessagesSchema, teamMembersSchema } from './schemas/chat-schema'
import { remindersSentSchema } from './schemas/reminders-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  gamesSchema,
  registrationsSchema,
  teamMembersSchema,
  gameMessagesSchema,
  remindersSentSchema,
]
