/** Client-side shape of a `games` record's `data` (see src/schemas/games-schema.ts). */

export type GameStatus = 'open' | 'full' | 'cancelled' | 'past'
export type SkillLevel = 'casual' | 'intermediate' | 'competitive'
export type Surface = 'grass' | 'turf' | 'indoor'

export interface Game {
  organizerId: string
  organizerName?: string
  title: string
  fieldName: string
  address?: string
  lat: number
  lng: number
  /** ISO 8601 UTC string. */
  startsAt: string
  durationMin: number
  maxPlayers: number
  playerCount: number
  cost?: string
  skillLevel: SkillLevel
  surface: Surface
  notes?: string
  status: GameStatus
}

/** "Sat 9:00 AM" in the viewer's local time — compact, for map pins. */
export function formatKickoffShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(undefined, { weekday: 'short' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} ${time}`
}

/** "Sat, Nov 28 · 9:00 AM" in the viewer's local time. */
export function formatKickoff(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}
