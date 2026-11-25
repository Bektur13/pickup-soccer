/**
 * Home — full-screen map of Bellevue, WA with a pin for every open/full game,
 * a small games list at the bottom centre, and a place search at the top
 * right. Data is live (useLiveGames → useQuery), so games created by other
 * users appear without a refresh.
 *
 * Two ways to start a game (signed in):
 *   - click an empty spot on the map → "Create a game here"
 *   - search a place (top right) → "Create a game here"
 * The create form (also opened by the top bar's "Create game", `?create=1`) is
 * a side panel; while it's open, clicking the map moves the field pin.
 */

import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from 'deepspace'
import { MapPin, Plus, X } from 'lucide-react'
import { PickupMap, type MapPin as GamePin, type PickupMapHandle } from '../../components/map/PickupMap'
import { GamesPanel } from '../../components/games/GamesPanel'
import { GameCard } from '../../components/games/GameCard'
import { CreateGameDialog, type ChosenLocation } from '../../components/games/CreateGameDialog'
import { PlaceSearch } from '../../components/map/PlaceSearch'
import { useLiveGames } from '../../hooks/useLiveGames'
import { Button } from '@/components/ui'
import { getJson } from '@/lib/api'
import { formatKickoffShort } from '@/lib/games'

type LatLng = { lat: number; lng: number }

export default function HomePage() {
  const { games, status } = useLiveGames()
  const { isSignedIn } = useAuth()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mapRef = useRef<PickupMapHandle>(null)

  // ── Create flow ─────────────────────────────────────────────────────────
  const [params, setParams] = useSearchParams()
  const createOpen = params.get('create') === '1' && isSignedIn
  const [location, setLocation] = useState<ChosenLocation | null>(null)
  /** A spot the user clicked / searched, offered as "Create a game here". */
  const [spot, setSpot] = useState<ChosenLocation | null>(null)
  const [searchPin, setSearchPin] = useState<LatLng | null>(null)

  /** Fill in a location's name/address from the worker (Nominatim, cached). */
  const withAddress = (at: ChosenLocation, apply: (loc: ChosenLocation) => void) => {
    apply(at)
    if (at.address) return
    getJson<{ place: { name: string; address: string } | null }>(`/api/places/reverse?lat=${at.lat}&lng=${at.lng}`)
      .then(({ place }) => {
        if (place) apply({ ...at, name: place.name, address: place.address })
      })
      .catch(() => {
        /* the coordinates are enough; the address is a nice-to-have */
      })
  }

  /**
   * Set the form's field location (map click, or a spot/search result), then
   * fill in its address. A late address for an older click never overwrites a
   * newer pin.
   */
  const setFormLocation = (at: ChosenLocation) =>
    withAddress(at, (loc) =>
      setLocation((cur) => (!cur || (cur.lat === at.lat && cur.lng === at.lng) || !loc.address ? loc : cur)),
    )

  const openCreateAt = (at: ChosenLocation | null) => {
    setSpot(null)
    setSelectedId(null)
    if (at) setFormLocation(at)
    setParams({ create: '1' }, { replace: true })
  }

  const closeCreate = () => setParams({}, { replace: true })

  const pins = useMemo<GamePin[]>(
    () =>
      games.map((g) => ({
        id: g.recordId,
        lat: g.data.lat,
        lng: g.data.lng,
        full: g.data.status === 'full',
        title: g.data.title,
        meta: `${formatKickoffShort(g.data.startsAt)} · ${g.data.playerCount ?? 0}/${g.data.maxPlayers}`,
      })),
    [games],
  )

  // Closes by itself if the game leaves the map (e.g. cancelled).
  const selectedGame = createOpen ? undefined : games.find((g) => g.recordId === selectedId)

  return (
    <div data-testid="home-map" className="relative h-full w-full">
      <PickupMap
        ref={mapRef}
        pins={pins}
        selectedId={selectedId}
        onSelectPin={(id) => {
          setSelectedId(id)
          if (id) setSpot(null)
        }}
        onMapClick={(at) => setSpot(isSignedIn ? at : null)}
        pickMode={createOpen}
        onPick={setFormLocation}
        draftPin={createOpen ? location : spot}
        searchPin={searchPin}
        // Under the right column: account (nav) → search → Create game → controls.
        controlsClassName={isSignedIn ? 'right-2 top-[8.75rem]' : 'right-2 top-[6rem]'}
      />

      {/* Right column, under the account (Navigation): search, then Create game. */}
      <div className="absolute right-2 top-12 z-20 flex w-[min(20rem,calc(100%-1rem))] flex-col items-end gap-2">
        <PlaceSearch
          className="w-full"
          onPick={(p) => {
            setSearchPin({ lat: p.lat, lng: p.lng })
            mapRef.current?.flyTo(p.lat, p.lng, 15)
            if (createOpen) setFormLocation(p)
            else if (isSignedIn) setSpot(p)
          }}
        />
        {isSignedIn && !createOpen && (
          <Button
            size="sm"
            onClick={() => openCreateAt(null)}
            data-testid="nav-create-game"
            className="rounded-full px-4 shadow-md"
          >
            <Plus aria-hidden /> Create game
          </Button>
        )}
      </div>

      {/* "Create a game here" for a clicked or searched spot. */}
      {spot && !createOpen && (
        <div
          data-testid="spot-prompt"
          // Phones: bottom centre (in place of the games list); md+: top centre,
          // between the nav pill and the account.
          className="absolute bottom-2 left-1/2 z-20 flex w-[min(24rem,calc(100%-1rem))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-xl backdrop-blur-md md:bottom-auto md:top-2"
        >
          <MapPin className="h-5 w-5 shrink-0 text-orange-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{spot.name || 'This spot'}</p>
            {spot.address && <p className="truncate text-xs text-muted-foreground">{spot.address}</p>}
          </div>
          <Button size="sm" onClick={() => openCreateAt(spot)} data-testid="spot-create">
            <Plus aria-hidden /> Create a game here
          </Button>
          <button
            type="button"
            onClick={() => setSpot(null)}
            aria-label="Dismiss"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {!createOpen && (
        <GamesPanel
          games={games}
          status={status}
          selectedId={selectedId}
          // On phones the open game card / spot prompt takes the bottom of the screen.
          className={selectedGame || spot ? 'max-md:hidden' : undefined}
          onSelect={(g) => {
            setSelectedId(g.recordId)
            setSpot(null)
            mapRef.current?.flyTo(g.data.lat, g.data.lng)
          }}
        />
      )}

      {selectedGame && (
        <GameCard key={selectedGame.recordId} game={selectedGame} onClose={() => setSelectedId(null)} />
      )}

      <CreateGameDialog
        open={createOpen}
        onClose={closeCreate}
        location={location}
        onLocationChange={setLocation}
        onCreated={(id, at) => {
          closeCreate()
          setLocation(null)
          setSelectedId(id)
          mapRef.current?.flyTo(at.lat, at.lng)
        }}
      />
    </div>
  )
}
