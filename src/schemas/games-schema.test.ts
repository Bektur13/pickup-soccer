/**
 * CLAUDE.md permission tests for `games`, run through DeepSpace's own RBAC
 * functions (deepspace/worker canRead/canCreate/canUpdate/canDelete/
 * checkFieldPermissions) against our real schema — the same checks the
 * RecordRoom applies to every browser write.
 */

import { describe, expect, it } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, checkFieldPermissions } from 'deepspace/worker'
import { gamesSchema } from './games-schema'
import { registrationsSchema } from './registrations-schema'

const game = {
  recordId: 'g1',
  createdBy: 'org',
  data: { organizerId: 'org', title: 'Saturday 7v7', maxPlayers: 10, playerCount: 3, status: 'open' },
}

describe('games permissions (CLAUDE.md)', () => {
  it('anyone, even signed out, can view games', () => {
    expect(canRead(gamesSchema, 'viewer', game, null as unknown as string)).toBe(true)
    expect(canRead(gamesSchema, 'anonymous', game, null as unknown as string)).toBe(true) // falls to '*'
    expect(canRead(gamesSchema, 'member', game, 'someone')).toBe(true)
  })

  it('signed-out users cannot create games or registrations (join)', () => {
    expect(canCreate(gamesSchema, 'viewer')).toBe(false)
    expect(canCreate(gamesSchema, 'anonymous')).toBe(false)
    expect(canCreate(registrationsSchema, 'viewer')).toBe(false)
  })

  it('signed-in users can create games', () => {
    expect(canCreate(gamesSchema, 'member')).toBe(true)
  })

  it('only the organizer can edit or delete their game', () => {
    expect(canUpdate(gamesSchema, 'member', game, 'org')).toBe(true)
    expect(canDelete(gamesSchema, 'member', game, 'org')).toBe(true)
    // A player who joined someone else's game gets no edit rights.
    expect(canUpdate(gamesSchema, 'member', game, 'player')).toBe(false)
    expect(canDelete(gamesSchema, 'member', game, 'player')).toBe(false)
    expect(canUpdate(gamesSchema, 'viewer', game, 'player')).toBe(false)
  })

  it('nobody can set playerCount/status/organizerId from the browser — not even the organizer', () => {
    for (const field of ['playerCount', 'status', 'organizerId']) {
      const next = { ...game.data, [field]: field === 'organizerId' ? 'someoneElse' : 99 }
      expect(checkFieldPermissions(gamesSchema, 'member', next, game.data)).toMatch(new RegExp(field))
      expect(checkFieldPermissions(gamesSchema, 'admin', next, game.data)).toMatch(new RegExp(field))
    }
    // …while normal fields are fine for the organizer.
    expect(checkFieldPermissions(gamesSchema, 'member', { ...game.data, title: 'Sunday 7v7' }, game.data)).toBeNull()
  })

  it('registrations (joining) can only be written by the server actions', () => {
    for (const role of ['viewer', 'member', 'admin']) expect(canCreate(registrationsSchema, role)).toBe(false)
  })
})