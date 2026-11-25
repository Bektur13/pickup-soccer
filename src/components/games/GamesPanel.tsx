/**
 * GamesPanel — the games list as a small pop-up at the bottom centre of the
 * map (styled like runningmap's floating bottom bar). It mirrors the map pins:
 * the same games, soonest first. Selecting an item selects its pin (and vice
 * versa via `selectedId`). Collapses to a compact "N games" pill.
 */

import { useEffect, useRef, useState } from 'react'
import type { RecordData } from 'deepspace'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { Badge, cn } from '@/components/ui'
import { formatKickoff, type Game } from '@/lib/games'

interface GamesPanelProps {
  games: RecordData<Game>[]
  status: 'loading' | 'ready' | 'error'
  selectedId: string | null
  onSelect: (game: RecordData<Game>) => void
  className?: string
}

export function GamesPanel({ games, status, selectedId, onSelect, className }: GamesPanelProps) {
  const [expanded, setExpanded] = useState(true)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  // Keep the selected game visible when it's picked from the map.
  useEffect(() => {
    if (!selectedId || !expanded) return
    itemRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId, expanded])

  const count = status === 'ready' ? games.length : null
  const label = count === null ? 'Games' : `${count} ${count === 1 ? 'game' : 'games'}`

  return (
    <aside
      data-testid="games-panel"
      className={cn(
        'pointer-events-auto absolute bottom-4 left-1/2 z-10 -translate-x-1/2',
        'flex flex-col overflow-hidden rounded-2xl border border-border bg-card/85 shadow-xl backdrop-blur-md',
        expanded ? 'w-[min(26rem,calc(100%-1.5rem))]' : 'w-auto',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid="games-panel-toggle"
        className={cn(
          'flex items-center gap-2 text-left',
          expanded ? 'justify-between px-4 py-2.5' : 'px-4 py-2',
        )}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
          {label}
          {!expanded && count !== null && count > 0 && (
            <span className="font-normal text-muted-foreground">· tap to list</span>
          )}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="max-h-[min(14rem,35vh)] overflow-y-auto border-t border-border">
          {status === 'loading' ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            </div>
          ) : status === 'error' ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Couldn&apos;t load games.</p>
          ) : games.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No upcoming games yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {games.map((g) => {
                const full = g.data.status === 'full'
                const selected = g.recordId === selectedId
                return (
                  <li key={g.recordId}>
                    <button
                      type="button"
                      data-testid="game-list-item"
                      ref={(el) => {
                        if (el) itemRefs.current.set(g.recordId, el)
                        else itemRefs.current.delete(g.recordId)
                      }}
                      onClick={() => onSelect(g)}
                      aria-current={selected ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-secondary',
                        selected && 'bg-secondary',
                      )}
                    >
                      <span
                        className={cn('h-2.5 w-2.5 shrink-0 rounded-full', full ? 'bg-gray-400' : 'bg-green-600')}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{g.data.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatKickoff(g.data.startsAt)} · {g.data.fieldName}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
                        <span data-testid="game-spots">
                          {g.data.playerCount ?? 0} / {g.data.maxPlayers} spots
                        </span>
                        {full && (
                          <Badge variant="secondary" size="sm">
                            Full
                          </Badge>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  )
}
