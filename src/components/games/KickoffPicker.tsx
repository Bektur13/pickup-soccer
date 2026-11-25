/**
 * KickoffPicker — date + time for a new game, as two buttons that open
 * pop-ups: a month calendar and a grid of times (15-minute steps, 6 AM–11 PM).
 * Past days, and past times on today, are disabled.
 *
 * Value is a local "YYYY-MM-DDTHH:mm" string (same format as
 * <input type="datetime-local">), so the form's validation is unchanged.
 * Pop-ups: the UI kit's Popover (Base UI, src/components/ui/Popover.tsx).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger, cn } from '@/components/ui'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Times offered: 6:00 AM … 10:45 PM in 15-minute steps, as "HH:mm". */
const TIMES = Array.from({ length: (23 - 6) * 4 }, (_, i) => {
  const mins = 6 * 60 + i * 15
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
})

function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const TRIGGER =
  'inline-flex h-10 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm text-foreground shadow-xs transition-colors hover:bg-secondary focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[popup-open]:border-ring'

interface KickoffPickerProps {
  /** "YYYY-MM-DDTHH:mm", local time. */
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}

export function KickoffPicker({ value, onChange, invalid }: KickoffPickerProps) {
  const [datePart, timePart = '18:00'] = value.split('T')
  const selected = useMemo(() => {
    const [y, mo, d] = datePart.split('-').map(Number)
    return new Date(y, (mo || 1) - 1, d || 1)
  }, [datePart])

  const [dateOpen, setDateOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)

  const setDate = (d: Date) => {
    onChange(`${ymd(d)}T${timePart}`)
    setDateOpen(false)
  }
  const setTime = (t: string) => {
    onChange(`${datePart}T${t}`)
    setTimeOpen(false)
  }

  return (
    <div className="grid grid-cols-[1.4fr_1fr] gap-2" data-testid="kickoff-picker">
      <Popover open={dateOpen} onOpenChange={setDateOpen}>
        <PopoverTrigger className={cn(TRIGGER, invalid && 'border-destructive')} data-testid="kickoff-date">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{formatDate(selected)}</span>
        </PopoverTrigger>
        <PopoverContent className="w-[18.5rem] p-3">
          <Calendar selected={selected} onSelect={setDate} />
        </PopoverContent>
      </Popover>

      <Popover open={timeOpen} onOpenChange={setTimeOpen}>
        <PopoverTrigger className={cn(TRIGGER, invalid && 'border-destructive')} data-testid="kickoff-time">
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{formatTime(timePart)}</span>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[17rem] p-2">
          <TimeGrid date={selected} value={timePart} onSelect={setTime} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function Calendar({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const today = startOfDay(new Date())
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const lead = first.getDay() // Sunday-first grid
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
    ]
  }, [month])

  const canGoBack = month > new Date(today.getFullYear(), today.getMonth(), 1)
  const saturday = new Date(today)
  saturday.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7)) // today if it's Saturday
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {[
          ['Today', today],
          ['Tomorrow', tomorrow],
          [today.getDay() === 6 ? 'Today (Sat)' : 'This Sat', saturday],
        ].map(([label, d]) => (
          <button
            key={label as string}
            type="button"
            onClick={() => onSelect(d as Date)}
            className="flex-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
          >
            {label as string}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          disabled={!canGoBack}
          aria-label="Previous month"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-secondary disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="text-sm font-semibold text-foreground">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          aria-label="Next month"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-secondary"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <span key={d} className="text-[11px] font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {days.map((d, i) => {
          if (!d) return <span key={`blank-${i}`} />
          const past = d < today
          const isSelected = ymd(d) === ymd(selected)
          const isToday = ymd(d) === ymd(today)
          return (
            <button
              key={ymd(d)}
              type="button"
              disabled={past}
              onClick={() => onSelect(d)}
              aria-pressed={isSelected}
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              className={cn(
                'h-8 rounded-md text-sm tabular-nums transition-colors',
                past && 'cursor-not-allowed text-muted-foreground/40',
                !past && !isSelected && 'text-foreground hover:bg-secondary',
                isToday && !isSelected && 'font-semibold ring-1 ring-inset ring-border',
                isSelected && 'bg-primary font-semibold text-primary-foreground',
              )}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TimeGrid({ date, value, onSelect }: { date: Date; value: string; onSelect: (t: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const now = new Date()
  const isToday = ymd(date) === ymd(now)
  const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}`

  // Bring the selected time into view when the pop-up opens.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <div ref={listRef} className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto p-1">
      {TIMES.map((t) => {
        const past = isToday && t <= nowHHMM
        const isSelected = t === value
        return (
          <button
            key={t}
            type="button"
            disabled={past}
            onClick={() => onSelect(t)}
            aria-pressed={isSelected}
            className={cn(
              'rounded-md px-1 py-1.5 text-xs tabular-nums transition-colors',
              past && 'cursor-not-allowed text-muted-foreground/40',
              !past && !isSelected && 'text-foreground hover:bg-secondary',
              isSelected && 'bg-primary font-semibold text-primary-foreground',
            )}
          >
            {formatTime(t)}
          </button>
        )
      })}
    </div>
  )
}
