/**
 * GameChat — the per-game chat pop-up (registered players + organizer).
 *
 * Reading: DeepSpace messaging's `useMessages(gameId)` (the game id is the
 * channel id). The RecordRoom only returns messages to chat members
 * (src/schemas/chat-schema.ts), so we first call `ensureChatAccess` and mount
 * the message list only after it succeeds — a subscription opened after
 * membership exists loads the full history (works around the SDK's missing
 * resubscribe on membership change).
 *
 * Posting: the `postGameMessage` server action (checks membership), not the
 * hook's `send`, which the schema doesn't allow from the browser.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth, useMessages, useUserLookup } from 'deepspace'
import { Loader2, MessageCircle, Send, X } from 'lucide-react'
import { Button, Input, cn, useToast } from '@/components/ui'
import { callAction } from '@/lib/api'
import { MESSAGE_MAX_LENGTH } from '@/schemas/chat-schema'

interface GameChatProps {
  gameId: string
  title: string
  onClose: () => void
}

export function GameChat({ gameId, title, onClose }: GameChatProps) {
  const [access, setAccess] = useState<{ ok: true } | { ok: false; error: string } | null>(null)

  useEffect(() => {
    let alive = true
    callAction('ensureChatAccess', { gameId }).then((r) => {
      if (alive) setAccess(r.success ? { ok: true } : { ok: false, error: r.error })
    })
    return () => {
      alive = false
    }
  }, [gameId])

  return (
    <section
      data-testid="game-chat"
      aria-label={`Chat: ${title}`}
      className={cn(
        'absolute z-30 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl',
        // phones: over the card; md+: just right of the card (left column)
        'inset-x-2 bottom-2 h-[60%] md:inset-x-auto md:bottom-2 md:left-[calc(0.5rem+24rem+0.5rem)] md:top-12 md:h-auto md:w-80',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title} · chat</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {access === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        </div>
      ) : access.ok ? (
        <ChatThread gameId={gameId} />
      ) : (
        <p className="flex-1 px-4 py-6 text-sm text-muted-foreground">{access.error}</p>
      )}
    </section>
  )
}

function ChatThread({ gameId }: { gameId: string }) {
  const { messages, status } = useMessages(gameId)
  const { getName } = useUserLookup()
  const { userId } = useAuth()
  const { error: toastError } = useToast()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    const r = await callAction('postGameMessage', { gameId, content })
    setSending(false)
    if (r.success) setDraft('')
    else toastError('Message not sent', r.error)
  }

  return (
    <>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="chat-messages">
        {status === 'loading' ? (
          <div className="flex justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No messages yet — say hi to your team.</p>
        ) : (
          messages.map((m) => {
            const mine = m.data.authorId === userId
            return (
              <div key={m.recordId} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                {!mine && (
                  <span className="mb-0.5 text-[11px] text-muted-foreground">{getName(m.data.authorId) ?? 'Player'}</span>
                )}
                <p
                  className={cn(
                    'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm',
                    mine ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                    m.data.deleted && 'italic opacity-60',
                  )}
                >
                  {m.data.deleted ? 'Message deleted' : m.data.content}
                </p>
                <time className="mt-0.5 text-[10px] text-muted-foreground" dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </time>
              </div>
            )
          })
        )}
      </div>
      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border p-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the team…"
          maxLength={MESSAGE_MAX_LENGTH}
          aria-label="Message"
          data-testid="chat-input"
        />
        <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send" data-testid="chat-send">
          {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        </Button>
      </form>
    </>
  )
}
