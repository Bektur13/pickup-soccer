/**
 * Transactional email through Resend, called from the worker (CLAUDE.md rule 4).
 *
 * The API key is a DeepSpace secret, never in code or the bundle (rule 3):
 *   npx deepspace secrets set RESEND_API_KEY=re_...
 *   npx deepspace secrets set EMAIL_FROM="Pickup Soccer <games@your-verified-domain>"   # optional
 * The worker reads them as env.RESEND_API_KEY / env.EMAIL_FROM — the same in
 * dev and after deploy (docs: https://docs.deep.space/guides/secrets). A
 * deployed app picks up new secret values at the next `deepspace deploy`.
 *
 * Without a verified domain, Resend only accepts the test sender
 * `onboarding@resend.dev`, which delivers only to the Resend account's own
 * inbox — fine for testing. Verify a domain in Resend and set EMAIL_FROM to
 * email any organizer.
 *
 * sendEmail() never throws: every failure (no key, Resend error, timeout) is
 * logged as `[email] …` and returned as { ok: false }, so callers can't let an
 * email problem break the operation that triggered it.
 */

export const RESEND_URL = 'https://api.resend.com/emails'
export const DEFAULT_FROM = 'Pickup Soccer <onboarding@resend.dev>'
const TIMEOUT_MS = 8000
const USER_AGENT = 'pickup-soccer/1.0 (+https://pickup-soccer.app.space)'

export interface EmailEnv {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export type SendResult = { ok: true; id?: string } | { ok: false; error: string }

export async function sendEmail(
  env: EmailEnv,
  message: EmailMessage,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<SendResult> {
  const fail = (error: string): SendResult => {
    console.error(`[email] not sent ("${message.subject}"): ${error}`)
    return { ok: false, error }
  }

  const apiKey = env.RESEND_API_KEY?.trim()
  if (!apiKey) return fail('RESEND_API_KEY secret is not set')
  if (!message.to) return fail('no recipient')

  try {
    const res = await fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM?.trim() || DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
    if (!res.ok) {
      // Resend's error body is { statusCode, name, message } — safe to log (no key in it).
      return fail(`Resend ${res.status} ${body.name ?? ''} ${body.message ?? ''}`.trim())
    }
    return { ok: true, id: body.id }
  } catch (err) {
    return fail(err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  }
}
