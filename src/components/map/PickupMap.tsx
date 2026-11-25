/**
 * PickupMap — a MapLibre GL canvas that fills its parent, with a floating
 * control stack (zoom in/out, recenter on Bellevue) and game pins.
 *
 * The map instance is created once on mount and disposed on unmount; React
 * never re-renders the canvas. Pins are a GeoJSON source + circle layer whose
 * data is replaced whenever `pins`/`selectedId` change. Give the parent a size
 * (e.g. `h-full w-full`).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, LocateFixed, Minus, Plus } from 'lucide-react'
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from '@/lib/map-config'
import { cn } from '@/lib/utils'

const PINS_SOURCE = 'game-pins'
const PINS_LAYER = 'game-pins'
const DRAFT_SOURCE = 'draft-pin'
const DRAFT_LAYER = 'draft-pin'
const COLOR_DRAFT = '#f97316' // orange: the field being chosen for a new game
const SEARCH_SOURCE = 'search-pin'
const SEARCH_LAYER = 'search-pin'
const COLOR_SEARCH = '#2563eb' // blue: the place found with the search bar

const COLOR_OPEN = '#16a34a' // green: spots left
const COLOR_FULL = '#9ca3af' // gray: full (CLAUDE.md "gray pin when full")
const COLOR_SELECTED_RING = '#0a0a0a'

export interface MapPin {
  id: string
  lat: number
  lng: number
  full: boolean
}

export interface PickupMapHandle {
  flyTo(lat: number, lng: number, zoom?: number): void
}

interface PickupMapProps {
  className?: string
  pins?: MapPin[]
  selectedId?: string | null
  /** A pin was clicked (its id), or empty map was clicked (null). */
  onSelectPin?: (id: string | null) => void
  /** A click on empty map (no game pin there), outside pick mode. */
  onMapClick?: (at: { lat: number; lng: number }) => void
  /** Location-picking mode: map clicks call onPick instead of selecting games. */
  pickMode?: boolean
  onPick?: (at: { lat: number; lng: number }) => void
  /** The location chosen for a new game, shown as an orange pin. */
  draftPin?: { lat: number; lng: number } | null
  /** The place found with the search bar, shown as a blue pin. */
  searchPin?: { lat: number; lng: number } | null
  /** Fires once the style has loaded, with the live map instance. */
  onReady?: (map: MlMap) => void
}

function pinsGeoJSON(pins: MapPin[], selectedId: string | null | undefined) {
  return {
    type: 'FeatureCollection' as const,
    features: pins.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { id: p.id, full: p.full, selected: p.id === selectedId },
    })),
  }
}

export const PickupMap = forwardRef<PickupMapHandle, PickupMapProps>(function PickupMap(
  {
    className,
    pins = [],
    selectedId,
    onSelectPin,
    onMapClick,
    pickMode = false,
    onPick,
    draftPin = null,
    searchPin = null,
    onReady,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  // Latest callbacks without re-running the init effect.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onSelectRef = useRef(onSelectPin)
  onSelectRef.current = onSelectPin
  const pickRef = useRef({ pickMode, onPick, onMapClick })
  pickRef.current = { pickMode, onPick, onMapClick }

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom) {
      const map = mapRef.current
      if (!map) return
      map.flyTo({ center: [lng, lat], zoom: zoom ?? Math.max(map.getZoom(), 14) })
    },
  }))

  // ── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
      // OpenFreeMap / OpenStreetMap attribution is required; keep it compact.
      attributionControl: { compact: true },
    })
    mapRef.current = map

    map.on('load', () => {
      map.addSource(PINS_SOURCE, { type: 'geojson', data: pinsGeoJSON([], null) })
      map.addLayer({
        id: PINS_LAYER,
        type: 'circle',
        source: PINS_SOURCE,
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 11, 8],
          'circle-color': ['case', ['get', 'full'], COLOR_FULL, COLOR_OPEN],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 2],
          'circle-stroke-color': ['case', ['get', 'selected'], COLOR_SELECTED_RING, '#ffffff'],
        },
      })

      map.addSource(SEARCH_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: SEARCH_LAYER,
        type: 'circle',
        source: SEARCH_SOURCE,
        paint: {
          'circle-radius': 7,
          'circle-color': COLOR_SEARCH,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })
      map.addSource(DRAFT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: DRAFT_LAYER,
        type: 'circle',
        source: DRAFT_SOURCE,
        paint: {
          'circle-radius': 10,
          'circle-color': COLOR_DRAFT,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      })

      // Pick mode → report the point. Otherwise: click a pin → select it;
      // click empty map → clear the selection.
      map.on('click', (e) => {
        if (pickRef.current.pickMode) {
          pickRef.current.onPick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng })
          return
        }
        const hit = map.queryRenderedFeatures(e.point, { layers: [PINS_LAYER] })[0]
        const id = hit?.properties?.id
        onSelectRef.current?.(typeof id === 'string' ? id : null)
        if (typeof id !== 'string') pickRef.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      })
      map.on('mouseenter', PINS_LAYER, () => {
        if (!pickRef.current.pickMode) map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', PINS_LAYER, () => {
        if (!pickRef.current.pickMode) map.getCanvas().style.cursor = ''
      })

      // The container may have been laid out after construction (flex parent).
      map.resize()
      setReady(true)
      onReadyRef.current?.(map)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ── Pins: push the latest data into the source ───────────────────────────
  useEffect(() => {
    if (!ready) return
    const source = mapRef.current?.getSource(PINS_SOURCE) as GeoJSONSource | undefined
    source?.setData(pinsGeoJSON(pins, selectedId))
  }, [ready, pins, selectedId])

  // ── Draft pin + pick-mode cursor ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const source = map.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: draftPin
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [draftPin.lng, draftPin.lat] }, properties: {} }]
        : [],
    })
  }, [ready, draftPin])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const source = map.getSource(SEARCH_SOURCE) as GeoJSONSource | undefined
    source?.setData({
      type: 'FeatureCollection',
      features: searchPin
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [searchPin.lng, searchPin.lat] }, properties: {} }]
        : [],
    })
  }, [ready, searchPin])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''
  }, [ready, pickMode])

  const recenter = () =>
    mapRef.current?.flyTo({
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: DEFAULT_ZOOM,
    })

  return (
    <div className={cn('relative h-full w-full', className)} data-map-ready={ready}>
      {/* Size with h-full/w-full, NOT `absolute inset-0`: MapLibre adds
          `.maplibregl-map { position: relative }` to this element from its
          unlayered stylesheet, which beats Tailwind's layered `absolute`, so
          `inset-0` would stop applying and the map would collapse to 0px tall. */}
      <div ref={containerRef} className="h-full w-full" aria-label="Map" role="region" />

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      )}

      {/* Floating control stack, top-right below the search bar (home.tsx). */}
      <div className="absolute right-3 top-[4.25rem] z-10 flex flex-col gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card/80 shadow-lg backdrop-blur-md">
          <CtrlButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <Plus className="h-4 w-4" aria-hidden />
          </CtrlButton>
          <div className="h-px bg-border" />
          <CtrlButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <Minus className="h-4 w-4" aria-hidden />
          </CtrlButton>
        </div>
        <CtrlButton label="Recenter on Bellevue" standalone onClick={recenter}>
          <LocateFixed className="h-4 w-4" aria-hidden />
        </CtrlButton>
      </div>
    </div>
  )
})

function CtrlButton({
  label,
  onClick,
  children,
  standalone,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  standalone?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 items-center justify-center text-foreground transition-colors hover:bg-secondary',
        standalone && 'rounded-xl border border-border bg-card/80 shadow-lg backdrop-blur-md',
      )}
    >
      {children}
    </button>
  )
}
