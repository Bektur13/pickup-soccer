/**
 * GamesPanel — the side list that mirrors the map pins: the same games, soonest
 * first. Selecting an item selects its pin (and vice versa via `selectedId`).
 *
 * Layout: a floating card on the left on md+ screens; a collapsible bottom
 * sheet on phones so it never covers the whole map.
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
}

export function GamesPanel({ games, status, selectedId, onSelect }: GamesPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  // Keep the selected game visible when it's picked from the map.
  useEffect(() => {
    if (!selectedId) return
    itemRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  return (
    <aside
      data-testid="games-panel"
      className={cn(
        'absolute z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-card/90 shadow-lg backdrop-blur-md',
        // phones: bottom sheet; md+: left column
        'inset-x-3 bottom-3 max-h-[45%] md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:max-h-none md:w-80',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex items-center justify-between px-4 py-3 text-left md:pointer-events-none"
      >
        <span className="text-sm font-semibold text-foreground">
          Games{status === 'ready' ? ` (${games.length})` : ''}
        </span>
        <span className="text-muted-foreground md:hidden" aria-hidden>
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      <div className={cn('min-h-0 flex-1 overflow-y-auto border-t border-border', collapsed && 'hidden md:block')}>
        {status === 'loading' ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          </div>
        ) : status === 'error' ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Couldn&apos;t load games.</p>
        ) : games.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No upcoming games yet.</p>
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
                      'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-secondary',
                      selected && 'bg-secondary',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn('h-2.5 w-2.5 shrink-0 rounded-full', full ? 'bg-gray-400' : 'bg-green-600')}
                        aria-hidden
                      />
                      <span className="truncate text-sm font-medium text-foreground">{g.data.title}</span>
                      {full && (
                        <Badge variant="secondary" size="sm" className="ml-auto">
                          Full
                        </Badge>
                      )}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">{g.data.fieldName}</span>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatKickoff(g.data.startsAt)}</span>
                      <span data-testid="game-spots">
                        {g.data.playerCount ?? 0} / {g.data.maxPlayers} spots
                      </span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
