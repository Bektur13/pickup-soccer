/**
 * CreateGameDialog — the "Create game" form (CLAUDE.md: search a field by name
 * or drop a pin, then time, max players, cost, skill, surface, notes).
 *
 * It's a side panel, not a modal, so the map stays usable: while it's open,
 * clicking the map sets the field location (home.tsx puts the map in pick
 * mode and owns the chosen location). Saving uses
 * `useMutations('games').createConfirmed`, which resolves only once the
 * RecordRoom has accepted the write (node_modules/deepspace/dist/index.d.ts),
 * so the dialog closes on real success. organizerId, playerCount and status are
 * set by the server (games-schema.ts), never here.
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutations, useUser } from 'deepspace'
import { Loader2, MapPin, MousePointerClick, Search, X } from 'lucide-react'
import { Button, Input, Label, Textarea, cn, useToast } from '@/components/ui'
import { getJson } from '@/lib/api'
import type { Game, SkillLevel, Surface } from '@/lib/games'

export interface ChosenLocation {
  lat: number
  lng: number
  name?: string
  address?: string
}

interface Place {
  name: string
  address: string
  lat: number
  lng: number
}

type NewGame = Omit<Game, 'organizerId' | 'playerCount' | 'status'>

interface CreateGameDialogProps {
  open: boolean
  onClose: () => void
  location: ChosenLocation | null
  onLocationChange: (location: ChosenLocation | null) => void
  onCreated: (gameId: string, at: { lat: number; lng: number }) => void
}

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultKickoff(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(18, 0, 0, 0)
  return toLocalInput(d)
}

const SELECT_CLASS =
  'h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function CreateGameDialog({
  open,
  onClose,
  location,
  onLocationChange,
  onCreated,
}: CreateGameDialogProps) {
  const { user } = useUser()
  const { createConfirmed, ready } = useMutations<NewGame>('games')
  const { success, error: toastError } = useToast()

  const [title, setTitle] = useState('')
  const [fieldName, setFieldName] = useState('')
  const [fieldNameTouched, setFieldNameTouched] = useState(false)
  const [startsLocal, setStartsLocal] = useState(defaultKickoff)
  const [durationMin, setDurationMin] = useState('90')
  const [maxPlayers, setMaxPlayers] = useState('14')
  const [cost, setCost] = useState('Free')
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('casual')
  const [surface, setSurface] = useState<Surface>('grass')
  const [notes, setNotes] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  // ── Place search (worker → Nominatim, cached) ───────────────────────────
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ q: string; places?: Place[]; error?: string } | null>(null)
  const trimmed = query.trim()
  useEffect(() => {
    if (trimmed.length < 3) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      getJson<{ places: Place[] }>(`/api/places/search?q=${encodeURIComponent(trimmed)}`, ctrl.signal, {
        auth: false, // public endpoint
      })
        .then((r) => setSearch({ q: trimmed, places: r.places }))
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setSearch({ q: trimmed, error: e instanceof Error ? e.message : 'Search failed' })
        })
    }, 450) // debounce: Nominatim asks for ≤1 request/second
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [trimmed])
  const searching = trimmed.length >= 3 && search?.q !== trimmed
  const results = trimmed.length >= 3 && search?.q === trimmed ? search : null

  const shownFieldName = fieldNameTouched ? fieldName : (location?.name ?? '')

  // ── Validation (CLAUDE.md: future start, 2–30 players) ──────────────────
  const errors = useMemo(() => {
    const e: Record<string, string> = {}
    if (!title.trim()) e.title = 'Give the game a title.'
    else if (title.trim().length > 80) e.title = 'Keep the title under 80 characters.'
    if (!location) e.location = 'Search for a field or drop a pin on the map.'
    if (!shownFieldName.trim()) e.fieldName = 'Name the field.'
    const start = new Date(startsLocal)
    if (Number.isNaN(start.getTime())) e.startsAt = 'Pick a date and time.'
    else if (start.getTime() <= Date.now()) e.startsAt = 'Kickoff must be in the future.'
    const max = Number(maxPlayers)
    if (!Number.isInteger(max) || max < 2 || max > 30) e.maxPlayers = 'Between 2 and 30 players.'
    const dur = Number(durationMin)
    if (!Number.isInteger(dur) || dur < 30 || dur > 240) e.durationMin = 'Between 30 and 240 minutes.'
    if (cost.length > 80) e.cost = 'Keep it under 80 characters.'
    if (notes.length > 1000) e.notes = 'Keep notes under 1000 characters.'
    return e
  }, [title, location, shownFieldName, startsLocal, maxPlayers, durationMin, cost, notes])
  const show = (k: string) => (submitted ? errors[k] : undefined)

  function reset() {
    setTitle('')
    setFieldName('')
    setFieldNameTouched(false)
    setStartsLocal(defaultKickoff())
    setNotes('')
    setQuery('')
    setSubmitted(false)
    onLocationChange(null)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || !location) return
    setSaving(true)
    try {
      const id = await createConfirmed({
        organizerName: (user?.name ?? '').slice(0, 80) || 'Organizer',
        title: title.trim(),
        fieldName: shownFieldName.trim().slice(0, 120),
        address: (location.address ?? '').slice(0, 300),
        lat: location.lat,
        lng: location.lng,
        startsAt: new Date(startsLocal).toISOString(),
        durationMin: Number(durationMin),
        maxPlayers: Number(maxPlayers),
        cost: cost.trim(),
        skillLevel,
        surface,
        notes: notes.trim(),
      })
      success('Game created', 'It’s on the map for everyone now.')
      const at = { lat: location.lat, lng: location.lng }
      reset()
      onCreated(id, at)
    } catch (err) {
      toastError('Could not create the game', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null // state is kept while hidden

  return (
    <section
      data-testid="create-game-dialog"
      aria-label="Create a game"
      className={cn(
        'absolute z-30 flex flex-col overflow-hidden border border-border bg-card shadow-2xl',
        // phones: bottom sheet (map stays clickable above it); md+: left column
        'inset-x-0 bottom-0 max-h-[70%] rounded-t-2xl md:inset-x-auto md:bottom-3 md:left-3 md:top-3 md:max-h-none md:w-[26rem] md:rounded-2xl',
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold text-foreground">Create a game</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <form id="create-game-form" onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4" noValidate>
        <Field label="Title" htmlFor="cg-title" error={show('title')}>
          <Input id="cg-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saturday 7v7" maxLength={80} />
        </Field>

        {/* Location: search OR drop a pin */}
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Label htmlFor="cg-search">Field location</Label>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="cg-click-hint">
            <MousePointerClick className="h-3.5 w-3.5 text-orange-500" aria-hidden />
            Click the map to place the field, or search for it:
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="cg-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a park or field, e.g. Crossroads Park"
              className="pl-8"
              autoComplete="off"
            />
          </div>
          {searching && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Searching…
            </p>
          )}
          {results?.error && <p className="text-xs text-destructive">{results.error}</p>}
          {results?.places && results.places.length === 0 && (
            <p className="text-xs text-muted-foreground">No places found — try another name or drop a pin.</p>
          )}
          {results?.places && results.places.length > 0 && (
            <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border" data-testid="cg-results">
              {results.places.map((p) => (
                <li key={`${p.lat},${p.lng}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onLocationChange(p)
                      setQuery('')
                    }}
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary"
                  >
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{p.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {location ? (
            <p className="flex items-start gap-2 text-xs text-foreground" data-testid="cg-location">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden />
              <span>{location.address || `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}</span>
            </p>
          ) : (
            show('location') && <p className="text-xs text-destructive">{show('location')}</p>
          )}
        </div>

        <Field label="Field name" htmlFor="cg-field" error={show('fieldName')}>
          <Input
            id="cg-field"
            value={shownFieldName}
            onChange={(e) => {
              setFieldNameTouched(true)
              setFieldName(e.target.value)
            }}
            placeholder="Crossroads Park, field 2"
            maxLength={120}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kickoff" htmlFor="cg-start" error={show('startsAt')}>
            <Input
              id="cg-start"
              type="datetime-local"
              value={startsLocal}
              min={toLocalInput(new Date())}
              onChange={(e) => setStartsLocal(e.target.value)}
            />
          </Field>
          <Field label="Duration" htmlFor="cg-duration" error={show('durationMin')}>
            <select id="cg-duration" className={SELECT_CLASS} value={durationMin} onChange={(e) => setDurationMin(e.target.value)}>
              {[60, 90, 120, 150, 180].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </Field>
          <Field label="Max players (2–30)" htmlFor="cg-max" error={show('maxPlayers')}>
            <Input
              id="cg-max"
              type="number"
              min={2}
              max={30}
              step={1}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
            />
          </Field>
          <Field label="Cost" htmlFor="cg-cost" error={show('cost')}>
            <Input id="cg-cost" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Free, or $5 at the field" maxLength={80} />
          </Field>
          <Field label="Skill level" htmlFor="cg-skill">
            <select id="cg-skill" className={SELECT_CLASS} value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillLevel)}>
              <option value="casual">Casual</option>
              <option value="intermediate">Intermediate</option>
              <option value="competitive">Competitive</option>
            </select>
          </Field>
          <Field label="Surface" htmlFor="cg-surface">
            <select id="cg-surface" className={SELECT_CLASS} value={surface} onChange={(e) => setSurface(e.target.value as Surface)}>
              <option value="grass">Grass</option>
              <option value="turf">Turf</option>
              <option value="indoor">Indoor</option>
            </select>
          </Field>
        </div>

        <Field label="Notes (optional)" htmlFor="cg-notes" error={show('notes')}>
          <Textarea
            id="cg-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Bring a light and a dark shirt."
            rows={3}
            maxLength={1000}
          />
        </Field>
      </form>

      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          form="create-game-form"
          disabled={!ready || saving}
          className={cn(saving && 'cursor-wait')}
          data-testid="cg-submit"
        >
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          Create game
        </Button>
      </div>
    </section>
  )
}
