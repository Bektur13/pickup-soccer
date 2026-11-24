/**
 * Pickup games — one record per game (CLAUDE.md "Data model → games").
 *
 * Permissions:
 *   - Anyone, even signed out, can read games (they're the public map).
 *   - Signed-in members can create games, and update/delete ONLY the games
 *     they organize ('own' → ownerField `organizerId`). Joining someone else's
 *     game never grants edit rights.
 *   - `playerCount` and `status` are server-only: they're left out of every
 *     role's `writableFields`, so the RecordRoom refuses any browser write to
 *     them. Only server actions (which skip user RBAC) change them — e.g. the
 *     future join/leave action. New games start at their `default`s.
 *
 * `organizerId` is `userBound` (the server stamps the caller's user id on
 * create and ignores client values) and `immutable`, so ownership can't be
 * spoofed or transferred from the browser.
 *
 * API references: node_modules/deepspace/dist/schema.d.ts (ColumnDefinition,
 * RolePermissions.writableFields); enforcement in dist/worker.js
 * (putRecord defaults/userBound, checkFieldPermissions).
 */

import type { CollectionSchema } from 'deepspace/schema'

/** Columns a browser may set. Everything except playerCount/status/organizerId. */
const CLIENT_WRITABLE = [
  'organizerName',
  'title',
  'fieldName',
  'address',
  'lat',
  'lng',
  'startsAt',
  'durationMin',
  'maxPlayers',
  'cost',
  'skillLevel',
  'surface',
  'notes',
]

export const gamesSchema: CollectionSchema = {
  name: 'games',
  ownerField: 'organizerId',
  columns: [
    { name: 'organizerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
    { name: 'organizerName', storage: 'text', interpretation: 'plain', maxLength: 80 },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    { name: 'fieldName', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'address', storage: 'text', interpretation: 'plain', maxLength: 300 },
    { name: 'lat', storage: 'number', interpretation: 'plain', required: true },
    { name: 'lng', storage: 'number', interpretation: 'plain', required: true },
    // ISO 8601 UTC string, e.g. "2026-11-28T17:00:00.000Z" — sorts correctly as text.
    { name: 'startsAt', storage: 'text', interpretation: { kind: 'datetime' }, required: true },
    { name: 'durationMin', storage: 'number', interpretation: 'plain', required: true },
    { name: 'maxPlayers', storage: 'number', interpretation: 'plain', required: true },
    // Server-only (not in CLIENT_WRITABLE).
    { name: 'playerCount', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'cost', storage: 'text', interpretation: 'plain', maxLength: 80 },
    {
      name: 'skillLevel',
      storage: 'text',
      interpretation: { kind: 'select', options: ['casual', 'intermediate', 'competitive'] },
      required: true,
    },
    {
      name: 'surface',
      storage: 'text',
      interpretation: { kind: 'select', options: ['grass', 'turf', 'indoor'] },
      required: true,
    },
    { name: 'notes', storage: 'text', interpretation: 'plain', maxLength: 1000 },
    // Server-only (not in CLIENT_WRITABLE).
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['open', 'full', 'cancelled', 'past'] },
      default: 'open',
    },
  ],
  permissions: {
    // Signed out (and any role without its own entry): view only.
    '*': { read: true, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    // Signed in: create games; edit/delete only the ones you organize.
    member: {
      read: true,
      create: true,
      update: 'own',
      delete: 'own',
      writableFields: CLIENT_WRITABLE,
    },
    // App owner: can moderate any game, but still can't set server-only fields.
    admin: {
      read: true,
      create: true,
      update: true,
      delete: true,
      writableFields: CLIENT_WRITABLE,
    },
  },
}
