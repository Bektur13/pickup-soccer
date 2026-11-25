/**
 * Home — full-screen map of Bellevue, WA with a pin for every open/full game
 * and a side list of the same games. Data is live (useLiveGames → useQuery),
 * so games created by other users appear without a refresh.
 *
 * `?create=1` (the top bar's "Create game") opens the create form. "Drop a pin"
 * hides the form until the user clicks the map.
 */

import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { MousePointerClick, X } from 'lucide-react'
import { PickupMap, type MapPin, type PickupMapHandle } from '../../components/map/PickupMap'
import { GamesPanel } from '../../components/games/GamesPanel'
import { GameCard } from '../../components/games/GameCard'
import { CreateGameDialog, type ChosenLocation } from '../../components/games/CreateGameDialog'
import { useLiveGames } from '../../hooks/useLiveGames'
import { getJson } from '@/lib/api'

export default function HomePage() {
  const { games, status } = useLiveGames()
  const { isSignedIn } = useAuth()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mapRef = useRef<PickupMapHandle>(null)

  // ── Create flow ─────────────────────────────────────────────────────────
  const [params, setParams] = useSearchParams()
  const createRequested = params.get('create') === '1' && isSignedIn
  const [picking, setPicking] = useState(false)
  const [location, setLocation] = useState<ChosenLocation | null>(null)

  const closeCreate = () => {
    setPicking(false)
    setParams({}, { replace: true })
  }

  const handlePick = (at: { lat: number; lng: number }) => {
    setPicking(false)
    setLocation(at)
    // Fill in the address for the dropped pin (worker → Nominatim, cached).
    getJson<{ place: { name: string; address: string } | null }>(
      `/api/places/reverse?lat=${at.lat}&lng=${at.lng}`,
    )
      .then(({ place }) => {
        if (place) {
          setLocation((cur) =>
            cur && cur.lat === at.lat && cur.lng === at.lng ? { ...at, name: place.name, address: place.address } : cur,
          )
        }
      })
      .catch(() => {
        /* the pin's coordinates are enough; the address is a nice-to-have */
      })
  }

  const pins = useMemo<MapPin[]>(
    () =>
      games.map((g) => ({
        id: g.recordId,
        lat: g.data.lat,
        lng: g.data.lng,
        full: g.data.status === 'full',
      })),
    [games],
  )

  // Closes by itself if the game leaves the map (e.g. cancelled).
  const selectedGame = games.find((g) => g.recordId === selectedId)

  return (
    <div data-testid="home-map" className="relative h-full w-full">
      <PickupMap
        ref={mapRef}
        pins={pins}
        selectedId={selectedId}
        onSelectPin={setSelectedId}
        pickMode={picking}
        onPick={handlePick}
        draftPin={createRequested ? location : null}
      />

      {!picking && (
        <GamesPanel
          games={games}
          status={status}
          selectedId={selectedId}
          onSelect={(g) => {
            setSelectedId(g.recordId)
            mapRef.current?.flyTo(g.data.lat, g.data.lng)
          }}
        />
      )}

      {selectedGame && !picking && (
        <GameCard key={selectedGame.recordId} game={selectedGame} onClose={() => setSelectedId(null)} />
      )}

      {picking && (
        <div
          data-testid="pick-banner"
          className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 text-sm shadow-lg backdrop-blur-md"
        >
          <MousePointerClick className="h-4 w-4 text-orange-500" aria-hidden />
          <span className="text-foreground">Click the map where the game will be played</span>
          <button
            type="button"
            onClick={() => setPicking(false)}
            aria-label="Cancel dropping a pin"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <CreateGameDialog
        open={createRequested && !picking}
        onClose={closeCreate}
        location={location}
        onLocationChange={setLocation}
        onRequestPick={() => setPicking(true)}
        onCreated={(id, at) => {
          closeCreate()
          setSelectedId(id)
          mapRef.current?.flyTo(at.lat, at.lng)
        }}
      />
    </div>
  )
}
