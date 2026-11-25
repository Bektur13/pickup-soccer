/**
 * PlaceSearch — the search bar at the top right of the map. Looks up
 * addresses and places through our worker (GET /api/places/search →
 * OpenStreetMap Nominatim, cached; CLAUDE.md rule 4 keeps it off the browser).
 * Picking a result calls onPick (home.tsx flies the map there).
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Search, X } from 'lucide-react'
import { cn } from '@/components/ui'
import { getJson } from '@/lib/api'

export interface PlaceResult {
  name: string
  address: string
  lat: number
  lng: number
}

export function PlaceSearch({ onPick, className }: { onPick: (place: PlaceResult) => void; className?: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<{ q: string; places?: PlaceResult[]; error?: string } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const q = query.trim()

  // Debounced search (≥3 characters).
  useEffect(() => {
    if (q.length < 3) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      getJson<{ places: PlaceResult[] }>(`/api/places/search?q=${encodeURIComponent(q)}`, ctrl.signal, {
        auth: false, // public endpoint
      })
        .then((r) => setResult({ q, places: r.places }))
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setResult({ q, error: e instanceof Error ? e.message : 'Search failed' })
        })
    }, 450)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const loading = q.length >= 3 && result?.q !== q
  const current = q.length >= 3 && result?.q === q ? result : null
  const showList = open && current && (current.error || current.places)

  return (
    <div ref={boxRef} className={cn('relative', className)} data-testid="place-search">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card/85 px-3 py-2 shadow-lg backdrop-blur-md focus-within:border-primary">
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="Search an address or park…"
          aria-label="Search for an address or place"
          data-testid="place-search-input"
          className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setOpen(false)
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {showList && (
        <ul
          data-testid="place-search-results"
          className="absolute right-0 top-[calc(100%+6px)] z-40 max-h-80 w-[min(24rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-border bg-card py-1 shadow-xl"
        >
          {current.error && <li className="px-3 py-2 text-sm text-muted-foreground">{current.error}</li>}
          {current.places?.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No places found.</li>
          )}
          {current.places?.map((p) => (
            <li key={`${p.lat},${p.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(p)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-secondary"
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.address}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
