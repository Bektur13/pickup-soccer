/**
 * PickupMap — a MapLibre GL canvas that fills its parent, with a floating
 * control stack (zoom in/out, recenter on Bellevue) and game pins.
 *
 * The map instance is created once on mount and disposed on unmount; React
 * never re-renders the canvas. Game pins are small floating label cards —
 * one maplibregl.Marker (HTML element) per game, kept in sync by id whenever
 * `pins`/`selectedId` change (styles in game-pin.css). Give the parent a size
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
import './game-pin.css'
import { Loader2, LocateFixed, Minus, Plus } from 'lucide-react'
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from '@/lib/map-config'
import { cn } from '@/lib/utils'

const DRAFT_SOURCE = 'draft-pin'
const DRAFT_LAYER = 'draft-pin'
const COLOR_DRAFT = '#f97316' // orange: the field being chosen for a new game
const SEARCH_SOURCE = 'search-pin'
const SEARCH_LAYER = 'search-pin'
const COLOR_SEARCH = '#2563eb' // blue: the place found with the search bar

export interface MapPin {
  id: string
  lat: number
  lng: number
  /** Grey pin when full (CLAUDE.md). */
  full: boolean
  /** Card text, e.g. "Saturday 7v7" / "Sat 6:00 PM · 6/14". */
  title: string
  meta: string
}

/** One game's marker: the element MapLibre positions, plus the parts we update. */
interface PinMarker {
  marker: maplibregl.Marker
  root: HTMLDivElement
  card: HTMLButtonElement
  title: HTMLSpanElement
  meta: HTMLSpanElement
}

/**
 * Build a pin's DOM. Text goes in via textContent (titles are user input —
 * never innerHTML). Clicks stop here so they don't also count as a map click.
 */
function createPinElement(onClick: () => void): Omit<PinMarker, 'marker'> {
  const root = document.createElement('div')
  root.className = 'gp-pin'
  const body = document.createElement('div')
  body.className = 'gp-pin__body'
  // Different float phase per pin so they don't bob in lockstep.
  body.style.animationDelay = `-${(Math.random() * 3.2).toFixed(2)}s`

  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'gp-pin__card'
  card.dataset.testid = 'game-pin'
  const ball = document.createElement('span')
  ball.className = 'gp-pin__ball'
  ball.textContent = '⚽'
  ball.setAttribute('aria-hidden', 'true')
  const text = document.createElement('span')
  text.className = 'gp-pin__text'
  const title = document.createElement('span')
  title.className = 'gp-pin__title'
  const meta = document.createElement('span')
  meta.className = 'gp-pin__meta'
  // appendChild, not append(): the worker types loaded by tsconfig replace the
  // DOM's append(...nodes) signature with HTMLRewriter's.
  text.appendChild(title)
  text.appendChild(meta)
  card.appendChild(ball)
  card.appendChild(text)

  const tail = document.createElement('span')
  tail.className = 'gp-pin__tail'
  const shadow = document.createElement('span')
  shadow.className = 'gp-pin__shadow'
  body.appendChild(card)
  body.appendChild(tail)
  root.appendChild(body)
  root.appendChild(shadow)

  for (const type of ['mousedown', 'dblclick', 'touchstart'] as const) {
    card.addEventListener(type, (e) => e.stopPropagation(), { passive: true })
  }
  card.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  return { root, card, title, meta }
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
  /** Position of the zoom/recenter stack (it sits under the page's right column). */
  controlsClassName?: string
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
    controlsClassName = 'right-2 top-2',
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markersRef = useRef(new Map<string, PinMarker>())
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

      // Pin clicks stop at the pin (createPinElement), so every click that
      // reaches the map is on empty map: in pick mode report the point,
      // otherwise clear the selection and offer the spot.
      map.on('click', (e) => {
        const at = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        if (pickRef.current.pickMode) {
          pickRef.current.onPick?.(at)
          return
        }
        onSelectRef.current?.(null)
        pickRef.current.onMapClick?.(at)
      })

      // The container may have been laid out after construction (flex parent).
      map.resize()
      setReady(true)
      onReadyRef.current?.(map)
    })

    const markers = markersRef.current
    return () => {
      markers.clear()
      map.remove() // also removes every marker element
      mapRef.current = null
    }
  }, [])

  // ── Pins: one floating card per game, synced by id ──────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const markers = markersRef.current
    const live = new Set<string>()

    for (const p of pins) {
      live.add(p.id)
      let m = markers.get(p.id)
      if (!m) {
        const parts = createPinElement(() => onSelectRef.current?.(p.id))
        const marker = new maplibregl.Marker({ element: parts.root, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .addTo(map)
        m = { marker, ...parts }
        markers.set(p.id, m)
      } else {
        m.marker.setLngLat([p.lng, p.lat])
      }
      const selected = p.id === selectedId
      m.title.textContent = p.title
      m.meta.textContent = p.meta
      m.card.setAttribute('aria-label', `${p.title}, ${p.meta}${p.full ? ', full' : ''}`)
      m.card.setAttribute('aria-pressed', String(selected))
      m.root.classList.toggle('gp-pin--full', p.full)
      m.root.classList.toggle('gp-pin--selected', selected)
      // Selected on top, then open games above full ones.
      m.root.style.zIndex = selected ? '3' : p.full ? '1' : '2'
    }

    for (const [id, m] of markers) {
      if (!live.has(id)) {
        m.marker.remove()
        markers.delete(id)
      }
    }
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
    // Pins fade and ignore clicks while a location is being picked (game-pin.css).
    map.getContainer().classList.toggle('gp-picking', pickMode)
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

      {/* Floating control stack (zoom, recenter), positioned by the page. */}
      <div className={cn('absolute z-10 flex flex-col gap-2', controlsClassName)}>
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
