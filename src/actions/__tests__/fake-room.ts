/**
 * A fake RecordRoom for unit-testing server actions. It mimics the real one's
 * guarantees (node_modules/deepspace/dist/worker.js putRecord):
 *   - each tool call executes atomically (one synchronous step),
 *   - separate calls from concurrent actions interleave (random delays before
 *     and after each call, like separate requests to the DO),
 *   - `uniqueOn: ['gameId','slot']` on registrations → "Duplicate: …",
 *   - `create` with a recordId upserts,
 *   - userBound columns are stamped with the caller's id.
 * Server actions bypass RBAC, so no permission checks happen here; read
 * privacy is tested with the SDK's own canRead (see chat.test.ts).
 */

import type { ActionContext, ActionTools } from 'deepspace/worker'
import type { Env } from '../../../worker'

export type Row = { recordId: string; createdBy: string; data: Record<string, unknown> }

/** Columns the RecordRoom stamps with the caller's user id. */
const USER_BOUND: Record<string, string> = {
  registrations: 'userId',
  team_members: 'userId',
  messages: 'authorId',
}

function jitter() {
  return new Promise<void>((r) => setTimeout(r, Math.random() * 4))
}

export class FakeRoom {
  tables = new Map<string, Map<string, Row>>()

  table(name: string) {
    let t = this.tables.get(name)
    if (!t) this.tables.set(name, (t = new Map()))
    return t
  }

  rows(name: string, where: Record<string, unknown> = {}) {
    return [...this.table(name).values()].filter((r) =>
      Object.entries(where).every(([k, v]) => r.data[k] === v),
    )
  }

  /** Tools as seen by one caller. Every call: delay → atomic step → delay. */
  toolsFor(userId: string): ActionTools {
    const call = async <T>(step: () => T): Promise<T> => {
      await jitter()
      const out = step() // synchronous = atomic, like putRecord in the DO
      await jitter()
      return out
    }
    const notFound = { success: false as const, error: 'Record not found' }
    const copy = (r: Row) => ({ ...r, data: { ...r.data } })

    const tools = {
      get: (collection: string, recordId: string) =>
        call(() => {
          const row = this.table(collection).get(recordId)
          return row ? { success: true, data: { record: copy(row) } } : notFound
        }),
      query: (collection: string, opts?: { where?: Record<string, unknown>; limit?: number }) =>
        call(() => {
          const records = this.rows(collection, opts?.where).slice(0, opts?.limit ?? 50).map(copy)
          return { success: true, data: { records, count: records.length } }
        }),
      create: (collection: string, data: Record<string, unknown>, recordId?: string) =>
        call(() => {
          const t = this.table(collection)
          const id = recordId ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const existing = t.get(id)
          const next = { ...(existing?.data ?? {}), ...data }
          const bound = USER_BOUND[collection]
          if (bound) next[bound] = existing ? existing.data[bound] : userId
          if (collection === 'registrations') {
            const clash = [...t.values()].some(
              (r) => r.recordId !== id && r.data.gameId === next.gameId && r.data.slot === next.slot,
            )
            if (clash) {
              return {
                success: false,
                error: `Duplicate: a record with gameId=${next.gameId}, slot=${next.slot} already exists in registrations`,
              }
            }
          }
          if (collection === 'team_members' && next.status === undefined) next.status = 'active'
          t.set(id, { recordId: id, createdBy: existing?.createdBy ?? userId, data: next })
          return { success: true, data: { recordId: id } }
        }),
      update: (collection: string, recordId: string, data: Record<string, unknown>) =>
        call(() => {
          const row = this.table(collection).get(recordId)
          if (!row) return notFound
          row.data = { ...row.data, ...data }
          return { success: true, data: { recordId } }
        }),
      remove: (collection: string, recordId: string) =>
        call(() =>
          this.table(collection).delete(recordId) ? { success: true, data: { recordId } } : notFound,
        ),
    }
    return tools as unknown as ActionTools
  }

  addGame(id: string, overrides: Record<string, unknown> = {}) {
    this.table('games').set(id, {
      recordId: id,
      createdBy: String(overrides.organizerId ?? 'org'),
      data: {
        organizerId: 'org',
        title: 'Test game',
        fieldName: 'Crossroads Park',
        lat: 47.6,
        lng: -122.2,
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        durationMin: 90,
        maxPlayers: 6,
        playerCount: 0,
        skillLevel: 'casual',
        surface: 'grass',
        status: 'open',
        ...overrides,
      },
    })
  }

  game(id: string) {
    return this.table('games').get(id)!.data
  }
}

/** Build an action context for `userId` against this room. */
export function ctx(room: FakeRoom, userId: string, params: Record<string, unknown>): ActionContext<Env> {
  return {
    userId,
    params,
    tools: room.toolsFor(userId),
    env: {},
    callerJwt: '',
  } as unknown as ActionContext<Env>
}
