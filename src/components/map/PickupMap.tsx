/**
 * PickupMap — a MapLibre GL canvas that fills its parent, with a floating
 * control stack (zoom in/out, recenter on Bellevue).
 *
 * The map instance is created once on mount and disposed on unmount; React
 * never re-renders the canvas. Give the parent a size (e.g. `h-full w-full`).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import maplibregl from 'maplibre-gl'
import type { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, LocateFixed, Minus, Plus } from 'lucide-react'
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE_URL } from '@/lib/map-config'
import { cn } from '@/lib/utils'

interface PickupMapProps {
  className?: string
  /** Fires once the style has loaded, with the live map instance. */
  onReady?: (map: MlMap) => void
}

export function PickupMap({ className, onReady }: PickupMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  // Latest callback without re-running the init effect.
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

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

      {/* Floating control stack, top-right under the top bar. */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
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
}

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
