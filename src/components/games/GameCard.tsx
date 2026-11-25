/**
 * GameCard — opens when a game is selected (pin or list). The header is
 * themed by the kickoff-hour forecast: sunny / cloudy / rainy / snowy, with
 * °F and chance of rain; games more than 16 days out show "Forecast not
 * available yet". Body: field, time, skill, surface, cost, organizer, spots.
 *
 * Join/Leave, the roster and the chat pop-up are added in the next step.
 */

import type { ComponentType, ReactNode } from 'react'
import type { RecordData } from 'deepspace'
import {
  CalendarClock,
  Cloud,
  CloudOff,
  CloudRain,
  Clock,
  DollarSign,
  Gauge,
  Layers,
  MapPin,
  Snowflake,
  Sun,
  User,
  X,
} from 'lucide-react'
import { Badge, cn } from '@/components/ui'
import { formatKickoff, type Game } from '@/lib/games'
import { describeWeatherCode, type WeatherTheme } from '@/lib/weather'
import { useGameWeather, type GameWeatherState } from '@/hooks/useGameWeather'

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

/** Per-theme look: header gradient + text colour, card accent, icon. */
const THEMES: Record<WeatherTheme, { label: string; header: string; accent: string; icon: IconType }> = {
  sunny: {
    label: 'Sunny',
    header: 'bg-linear-to-br from-amber-200 via-amber-300 to-orange-400 text-amber-950',
    accent: 'border-amber-400/60',
    icon: Sun,
  },
  cloudy: {
    label: 'Cloudy',
    header: 'bg-linear-to-br from-slate-200 via-slate-300 to-slate-400 text-slate-900',
    accent: 'border-slate-400/60',
    icon: Cloud,
  },
  rainy: {
    label: 'Rainy',
    header: 'bg-linear-to-br from-sky-600 via-blue-700 to-indigo-800 text-white',
    accent: 'border-blue-500/60',
    icon: CloudRain,
  },
  snowy: {
    label: 'Snowy',
    header: 'bg-linear-to-br from-white via-sky-50 to-sky-200 text-sky-950',
    accent: 'border-sky-300/70',
    icon: Snowflake,
  },
}

const NEUTRAL_HEADER = 'bg-secondary text-foreground'

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function WeatherHeader({ state }: { state: GameWeatherState }) {
  if (state.status === 'loading') {
    return (
      <div className={cn('flex items-center gap-3 px-5 py-4', NEUTRAL_HEADER)} aria-busy="true">
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-5 w-20 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
    )
  }

  if (state.status === 'error' || !state.weather.available) {
    const w = state.status === 'ready' ? state.weather : null
    const tooFar = w?.available === false && w.reason === 'too_far'
    const past = w?.available === false && w.reason === 'past'
    const Icon = tooFar ? CalendarClock : CloudOff
    return (
      <div className={cn('flex items-center gap-3 px-5 py-4', NEUTRAL_HEADER)} data-weather-theme="none">
        <Icon className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium" data-testid="weather-message">
            {tooFar ? 'Forecast not available yet' : past ? 'This game has finished' : 'Weather unavailable right now'}
          </p>
          {tooFar && w?.available === false && w.availableFrom && (
            <p className="text-xs text-muted-foreground">Check back around {shortDate(w.availableFrom)}</p>
          )}
        </div>
      </div>
    )
  }

  const w = state.weather
  const theme = THEMES[w.theme]
  const Icon = theme.icon
  return (
    <div className={cn('flex items-center gap-4 px-5 py-4', theme.header)} data-weather-theme={w.theme}>
      <Icon className="h-10 w-10 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-2xl font-semibold leading-none" data-testid="weather-temp">
          {w.temperatureF}°F
        </p>
        <p className="mt-1 text-sm opacity-90">
          {describeWeatherCode(w.weatherCode)}
          {w.precipitationProbability !== null && <> · {w.precipitationProbability}% chance of rain</>}
        </p>
      </div>
      <span className="ml-auto self-start rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide">
        {theme.label}
      </span>
    </div>
  )
}

function Detail({ icon: Icon, children }: { icon: IconType; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </li>
  )
}

interface GameCardProps {
  game: RecordData<Game>
  onClose: () => void
}

export function GameCard({ game, onClose }: GameCardProps) {
  const g = game.data
  const weather = useGameWeather(game.recordId, g.startsAt)
  const theme =
    weather.status === 'ready' && weather.weather.available ? THEMES[weather.weather.theme] : null
  const full = g.status === 'full'
  const spotsTaken = g.playerCount ?? 0
  const spotsLeft = Math.max(0, g.maxPlayers - spotsTaken)

  return (
    <section
      data-testid="game-card"
      aria-label={`Game: ${g.title}`}
      className={cn(
        'absolute z-20 flex flex-col overflow-hidden rounded-2xl border-2 bg-card shadow-2xl',
        // phones: sheet over the list; md+: right column, clear of the map controls
        'inset-x-3 bottom-3 max-h-[75%] md:inset-x-auto md:bottom-auto md:right-16 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-96',
        theme?.accent ?? 'border-border',
      )}
    >
      <div className="relative">
        <WeatherHeader state={weather} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close game card"
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/10 text-current hover:bg-black/20"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{g.title}</h2>
          {g.organizerName && (
            <p className="text-sm text-muted-foreground">Organized by {g.organizerName}</p>
          )}
        </div>

        <ul className="space-y-2.5">
          <Detail icon={MapPin}>
            <span className="font-medium">{g.fieldName}</span>
            {g.address && <span className="block text-xs text-muted-foreground">{g.address}</span>}
          </Detail>
          <Detail icon={Clock}>
            {formatKickoff(g.startsAt)} · {g.durationMin} min
          </Detail>
          <Detail icon={Gauge}>{capitalize(g.skillLevel)}</Detail>
          <Detail icon={Layers}>{capitalize(g.surface)}</Detail>
          {g.cost && <Detail icon={DollarSign}>{g.cost}</Detail>}
          {g.organizerName && <Detail icon={User}>{g.organizerName}</Detail>}
        </ul>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground" data-testid="game-card-spots">
              {spotsTaken} / {g.maxPlayers} spots
            </span>
            {full ? (
              <Badge variant="secondary">Full</Badge>
            ) : (
              <span className="text-muted-foreground">
                {spotsLeft} left
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn('h-full rounded-full', full ? 'bg-gray-400' : 'bg-green-600')}
              style={{ width: `${Math.min(100, (spotsTaken / Math.max(1, g.maxPlayers)) * 100)}%` }}
            />
          </div>
        </div>

        {g.notes && <p className="whitespace-pre-line text-sm text-muted-foreground">{g.notes}</p>}
      </div>
    </section>
  )
}
