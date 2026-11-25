/**
 * Home — full-screen map of Bellevue, WA with a pin for every open/full game
 * and a side list of the same games. Data is live (useLiveGames → useQuery),
 * so games created by other users appear without a refresh.
 */

import { useMemo, useRef, useState } from 'react'
import { PickupMap, type MapPin, type PickupMapHandle } from '../../components/map/PickupMap'
import { GamesPanel } from '../../components/games/GamesPanel'
import { GameCard } from '../../components/games/GameCard'
import { useLiveGames } from '../../hooks/useLiveGames'

export default function HomePage() {
  const { games, status } = useLiveGames()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mapRef = useRef<PickupMapHandle>(null)

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
      <PickupMap ref={mapRef} pins={pins} selectedId={selectedId} onSelectPin={setSelectedId} />
      <GamesPanel
        games={games}
        status={status}
        selectedId={selectedId}
        onSelect={(g) => {
          setSelectedId(g.recordId)
          mapRef.current?.flyTo(g.data.lat, g.data.lng)
        }}
      />
      {selectedGame && (
        <GameCard key={selectedGame.recordId} game={selectedGame} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
