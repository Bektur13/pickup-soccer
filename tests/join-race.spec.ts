/**
 * CLAUDE.md required test: two users try to join the last spot at the same
 * time → exactly one succeeds.
 *
 * Runs against the real local stack (vite + workerd + the app's RecordRoom
 * Durable Object), with two signed-in test accounts from `deepspace/testing`.
 *
 * Setup without a create-game UI (not built yet): Alice's browser creates the
 * game the same way the app does — a `core.put` over the records WebSocket
 * with her own session token, so the RecordRoom applies the normal member
 * permissions (organizerId is stamped to Alice; playerCount/status get their
 * server defaults). The game has `maxPlayers: 1`, so its only spot IS the last
 * spot, and both users race for it with the real `joinGame` server action.
 *
 * Protocol references (node_modules/deepspace/dist):
 *   - token: index.js getAuthToken → POST /api/auth/token
 *   - socket URL `/ws/<roomId>?token=…`: index.js (RecordRoom connection)
 *   - `core.put` / `core.delete` with requestId → `records.ack`:
 *     worker.d.ts clientBuild, worker.js handlePut + serverBuild.ackSuccess
 *
 * Run:  npx deepspace test run tests/join-race.spec.ts   (add --headed to watch)
 * Needs: 2 test accounts — `npx deepspace test accounts create …`
 */

import { readFileSync } from 'node:fs'
import { test, expect, loadAllTestAccounts, type MultiplayerUser } from 'deepspace/testing'

// The records room every client connects to: SCOPE_ID = `app:${APP_ID}`.
const APP_ID = /DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/.exec(
  readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'),
)?.[1]
const ROOM_ID = `app:${APP_ID}`

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

type Ack = { success: boolean; recordId?: string; error?: string }
type ActionResponse = { status: number; body: { success?: boolean; code?: string; error?: string } }
type RecordMessage =
  | { type: 'core.put'; payload: { collection: string; recordId: string; requestId: string; data: Record<string, unknown> } }
  | { type: 'core.delete'; payload: { collection: string; recordId: string; requestId: string } }

/** The signed-in user's DeepSpace JWT — the same call the SDK's getAuthToken makes. */
async function authToken(user: MultiplayerUser): Promise<string> {
  const token = await user.page.evaluate(async () => {
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    return res.ok ? (((await res.json()) as { token?: string }).token ?? null) : null
  })
  if (!token) throw new Error(`${user.email}: could not get an auth token`)
  return token
}

/** Send one confirmed record write as `user` over the records WebSocket; resolve with its ack. */
async function writeRecord(user: MultiplayerUser, token: string, message: RecordMessage): Promise<Ack> {
  return user.page.evaluate(
    async ({ roomId, token, message }) => {
      const url = `${location.origin.replace(/^http/, 'ws')}/ws/${roomId}?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(url)
      try {
        return await new Promise<{ success: boolean; recordId?: string; error?: string }>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no records.ack within 10s')), 10_000)
          ws.onerror = () => {
            clearTimeout(timer)
            reject(new Error('records WebSocket error'))
          }
          ws.onopen = () => ws.send(JSON.stringify(message))
          ws.onmessage = (event) => {
            const msg = JSON.parse(String(event.data)) as {
              type: string
              payload?: { requestId?: string; success: boolean; recordId?: string; error?: string }
            }
            if (msg.type === 'records.ack' && msg.payload?.requestId === message.payload.requestId) {
              clearTimeout(timer)
              resolve(msg.payload)
            }
          }
        })
      } finally {
        ws.close()
      }
    },
    { roomId: ROOM_ID, token, message },
  )
}

/** Call a server action as `user` (POST /api/actions/<name>, Bearer token). */
async function callAction(
  user: MultiplayerUser,
  token: string,
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse> {
  return user.page.evaluate(
    async ({ name, params, token }) => {
      const res = await fetch(`/api/actions/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(params),
      })
      return { status: res.status, body: await res.json() }
    },
    { name, params, token },
  )
}

/** The game's row in a user's live side-panel list. */
const listItem = (user: MultiplayerUser, title: string) =>
  user.page.getByTestId('game-list-item').filter({ hasText: title })

test('two users join the last spot at the same time: exactly one succeeds', async ({ users }) => {
  expect(APP_ID, 'DEEPSPACE_APP_ID in wrangler.toml').toMatch(/^app_/)

  const [alice, bob] = await users(2)
  await Promise.all([alice.page.goto('/home'), bob.page.goto('/home')])
  for (const u of [alice, bob]) {
    await expect(u.page.getByTestId('games-panel')).toBeVisible({ timeout: 15_000 })
  }
  const [aliceToken, bobToken] = await Promise.all([authToken(alice), authToken(bob)])

  // ── Setup: Alice organizes a game with exactly one spot ─────────────────
  const gameId = `e2e_race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const title = `E2E last spot ${gameId.slice(-6)}`
  const created = await writeRecord(alice, aliceToken, {
    type: 'core.put',
    payload: {
      collection: 'games',
      recordId: gameId,
      requestId: `${gameId}-create`,
      data: {
        organizerName: 'Alice (e2e)',
        title,
        fieldName: 'Crossroads Park',
        address: '16000 NE 10th St, Bellevue, WA',
        lat: 47.6177,
        lng: -122.1277,
        startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        durationMin: 90,
        maxPlayers: 1,
        cost: 'Free',
        skillLevel: 'casual',
        surface: 'grass',
      },
    },
  })
  expect(created, `create game failed: ${created.error}`).toMatchObject({ success: true })

  try {
    // Both users see the new game live, with its one open spot.
    for (const u of [alice, bob]) {
      await expect(listItem(u, title)).toContainText('0 / 1 spots', { timeout: 15_000 })
    }

    // ── The race: both join at the same moment ────────────────────────────
    const results = await Promise.all([
      callAction(alice, aliceToken, 'joinGame', { gameId }),
      callAction(bob, bobToken, 'joinGame', { gameId }),
    ])
    const detail = JSON.stringify(results)

    for (const r of results) expect(r.status, detail).toBe(200)
    const winners = results.filter((r) => r.body.success === true)
    const losers = results.filter((r) => r.body.success !== true)
    expect(winners, `exactly one join should succeed: ${detail}`).toHaveLength(1)
    expect(losers, detail).toHaveLength(1)
    expect(losers[0].body, detail).toMatchObject({ success: false, code: 'full' })

    // Both users' lists update live: 1 / 1 and Full.
    for (const u of [alice, bob]) {
      await expect(listItem(u, title)).toContainText('1 / 1 spots', { timeout: 15_000 })
      await expect(listItem(u, title)).toContainText('Full')
    }
  } finally {
    // Cleanup: the winner leaves (removes their registration + chat membership),
    // then the organizer deletes the game.
    await Promise.all([
      callAction(alice, aliceToken, 'leaveGame', { gameId }),
      callAction(bob, bobToken, 'leaveGame', { gameId }),
    ])
    await writeRecord(alice, aliceToken, {
      type: 'core.delete',
      payload: { collection: 'games', recordId: gameId, requestId: `${gameId}-delete` },
    })
  }
})
