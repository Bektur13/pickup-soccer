/**
 * GameCard — opens when a game is selected (pin or list). The header is
 * themed by the kickoff-hour forecast: sunny / cloudy / rainy / snowy, with
 * °F and chance of rain; games more than 16 days out show "Forecast not
 * available yet". Body: field, time, skill, surface, cost, organizer, spots.
 *
 * Below that: the live roster (registrations), the Join / Leave / Full button
 * (server actions joinGame/leaveGame — race-safe, src/actions/games.ts), and
 * the chat pop-up for registered players and the organizer.
 */

import { useState, type ComponentType, type ReactNode } from 'react'
import { AuthOverlay, useAuth, useQuery, type RecordData } from 'deepspace'
import {
  CalendarClock,
  Cloud,
  CloudOff,
  CloudRain,
  Clock,
  Crown,
  DollarSign,
  Gauge,
  Layers,
  Loader2,
  MapPin,
  MessageCircle,
  Snowflake,
  Sun,
  User,
  Users,
  X,
} from 'lucide-react'
import { Badge, Button, cn, useToast } from '@/components/ui'
import { callAction } from '@/lib/api'
import { GameChat } from './GameChat'
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

interface Registration {
  gameId: string
  userId: string
  userName?: string
  slot: number
}

/** Join / Leave / Full / Sign in — plus the Chat button for members. */
function GameActions({
  game,
  isRegistered,
  onJoined,
  onOpenChat,
}: {
  game: RecordData<Game>
  isRegistered: boolean
  onJoined: () => void
  onOpenChat: () => void
}) {
  const g = game.data
  const { isSignedIn, userId } = useAuth()
  const { success, error } = useToast()
  const [busy, setBusy] = useState<'join' | 'leave' | null>(null)
  const [showSignIn, setShowSignIn] = useState(false)

  const isOrganizer = !!userId && userId === g.organizerId
  const started = Date.parse(g.startsAt) <= Date.now()
  const closed = g.status === 'cancelled' || g.status === 'past'

  async function join() {
    setBusy('join')
    const r = await callAction<{ alreadyJoined?: boolean }>('joinGame', { gameId: game.recordId })
    setBusy(null)
    if (r.success) {
      success(r.data.alreadyJoined ? 'You’re already in' : 'You’re in!', 'Say hi to the team in the chat.')
      onJoined()
    } else {
      error('Could not join', r.error)
    }
  }

  async function leave() {
    setBusy('leave')
    const r = await callAction('leaveGame', { gameId: game.recordId })
    setBusy(null)
    if (r.success) success('You left the game')
    else error('Could not leave', r.error)
  }

  let primary: ReactNode
  if (!isSignedIn) {
    primary = (
      <Button className="flex-1" onClick={() => setShowSignIn(true)} data-testid="game-signin-to-join">
        Sign in to join
      </Button>
    )
  } else if (isRegistered) {
    primary = (
      <Button
        variant="outline"
        className="flex-1"
        onClick={leave}
        disabled={busy !== null || started || closed}
        data-testid="game-leave"
      >
        {busy === 'leave' && <Loader2 className="animate-spin" aria-hidden />}
        Leave game
      </Button>
    )
  } else if (closed || started) {
    primary = (
      <Button className="flex-1" disabled>
        {g.status === 'cancelled' ? 'Cancelled' : 'Kicked off'}
      </Button>
    )
  } else if (g.status === 'full') {
    primary = (
      <Button className="flex-1" disabled data-testid="game-full">
        Full
      </Button>
    )
  } else {
    primary = (
      <Button className="flex-1" onClick={join} disabled={busy !== null} data-testid="game-join">
        {busy === 'join' && <Loader2 className="animate-spin" aria-hidden />}
        Join game
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {primary}
      {isSignedIn && (isRegistered || isOrganizer) && (
        <Button variant="secondary" onClick={onOpenChat} data-testid="game-open-chat">
          <MessageCircle aria-hidden /> Chat
        </Button>
      )}
      {showSignIn && <AuthOverlay providers={['google']} onClose={() => setShowSignIn(false)} />}
    </div>
  )
}

function Roster({ players, organizerId, loading }: { players: RecordData<Registration>[]; organizerId: string; loading: boolean }) {
  return (
    <div className="space-y-2" data-testid="game-roster">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden /> Players
      </h3>
      {loading ? (
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      ) : players.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one yet — be the first.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {players.map((p) => (
            <li
              key={p.recordId}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
            >
              {p.data.userId === organizerId && <Crown className="h-3 w-3 text-amber-500" aria-label="Organizer" />}
              {p.data.userName || 'Player'}
            </li>
          ))}
        </ul>
      )}
    </div>
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

  // Live roster: registrations are readable by everyone (names only).
  const { userId } = useAuth()
  const roster = useQuery<Registration>('registrations', {
    where: { gameId: game.recordId },
    orderBy: 'createdAt',
    orderDir: 'asc',
  })
  const isRegistered = !!userId && roster.records.some((r) => r.data.userId === userId)
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <>
    {chatOpen && <GameChat gameId={game.recordId} title={g.title} onClose={() => setChatOpen(false)} />}
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

        <Roster players={roster.records} organizerId={g.organizerId} loading={roster.status === 'loading'} />
      </div>

      <div className="border-t border-border px-5 py-3">
        <GameActions
          game={game}
          isRegistered={isRegistered}
          onJoined={() => setChatOpen(true)}
          onOpenChat={() => setChatOpen(true)}
        />
      </div>
    </section>
    </>
  )
}
