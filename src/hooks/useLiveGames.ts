/**
 * useLiveGames — every game shown on the map: status `open` or `full`,
 * soonest first.
 *
 * `useQuery` is a live subscription to the app's RecordRoom over its
 * WebSocket, so a game another user creates (or a status change from the
 * server) appears here without a refresh. `where` is equality-only (the
 * RecordRoom refuses anything else — dist/worker.js `refuseUnknownWhere`),
 * so open and full are two queries merged.
 *
 * API: `useQuery` / `RecordData` — node_modules/deepspace/dist/index.d.ts;
 * docs: https://docs.deep.space/sdk-reference/client/records
 */

import { useMemo } from 'react'
import { useQuery, type RecordData } from 'deepspace'
import type { Game } from '../lib/games'

export function useLiveGames(): {
  games: RecordData<Game>[]
  status: 'loading' | 'ready' | 'error'
  error?: string
} {
  const open = useQuery<Game>('games', { where: { status: 'open' } })
  const full = useQuery<Game>('games', { where: { status: 'full' } })

  const games = useMemo(
    () =>
      [...open.records, ...full.records].sort((a, b) =>
        a.data.startsAt.localeCompare(b.data.startsAt),
      ),
    [open.records, full.records],
  )

  const status =
    open.status === 'error' || full.status === 'error'
      ? 'error'
      : open.status === 'ready' && full.status === 'ready'
        ? 'ready'
        : 'loading'

  return { games, status, error: open.error ?? full.error }
}
