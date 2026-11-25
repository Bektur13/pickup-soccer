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

/** `uniqueOn` per collection, enforced in create like the RecordRoom does. */
const UNIQUE_ON: Record<string, string[]> = {
  registrations: ['gameId', 'slot'],
  reminders_sent: ['gameId', 'userId'],
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
      Object.entries(where).every(([k, v]) => (k === 'recordId' ? r.recordId === v : r.data[k] === v)),
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
          const unique = UNIQUE_ON[collection]
          if (unique) {
            const clash = [...t.values()].some(
              (r) => r.recordId !== id && unique.every((f) => r.data[f] === next[f]),
            )
            if (clash) {
              const fields = unique.map((f) => `${f}=${next[f]}`).join(', ')
              return { success: false, error: `Duplicate: a record with ${fields} already exists in ${collection}` }
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

/**
 * The cron context's `records` API (deepspace/worker buildCronContext) over
 * this room: acts as the owner, returns data directly, throws on failure
 * with the same "RecordRoom tool … failed: <error>" message.
 */
export function cronRecordsFor(room: FakeRoom, ownerId = 'owner') {
  const tools = room.toolsFor(ownerId)
  const unwrap = <T>(tool: string, r: { success: boolean; data?: T; error?: string }): T => {
    if (!r.success) throw new Error(`RecordRoom tool ${tool} failed: ${r.error}`)
    return r.data as T
  }
  return {
    query: async (collection: string, opts?: { where?: Record<string, unknown>; limit?: number }) =>
      unwrap<{ records: unknown[] }>('records.query', await tools.query(collection, opts)).records,
    create: async (collection: string, data: Record<string, unknown>) =>
      unwrap('records.create', await tools.create(collection, data)),
    update: async (collection: string, recordId: string, data: Record<string, unknown>) =>
      unwrap('records.update', await tools.update(collection, recordId, data)),
    delete: async (collection: string, recordId: string) =>
      unwrap('records.delete', await tools.remove(collection, recordId)),
  }
}

/** Build an action context for `userId` against this room. */
export function ctx(
  room: FakeRoom,
  userId: string,
  params: Record<string, unknown>,
  env: Partial<Env> = {},
): ActionContext<Env> {
  return {
    userId,
    params,
    tools: room.toolsFor(userId),
    env,
    callerJwt: '',
  } as unknown as ActionContext<Env>
}
