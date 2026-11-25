import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FROM, RESEND_URL, sendEmail } from './email'

const KEY = 'fake-resend-key-for-tests'
const msg = { to: 'org@example.com', subject: 'Alice joined "Saturday 7v7"', text: 'hello' }

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status }),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('sendEmail', () => {
  it('POSTs to Resend with the secret key, default sender, and recipient list', async () => {
    const f = fakeFetch(200, { id: 'email_1' })
    const r = await sendEmail({ RESEND_API_KEY: KEY }, msg, f as unknown as typeof fetch)

    expect(r).toEqual({ ok: true, id: 'email_1' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(RESEND_URL)
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(headers['User-Agent']).toMatch(/pickup-soccer/)
    expect(JSON.parse(String(init?.body))).toEqual({
      from: DEFAULT_FROM,
      to: ['org@example.com'],
      subject: msg.subject,
      text: 'hello',
    })
  })

  it('uses the EMAIL_FROM secret when set', async () => {
    const f = fakeFetch(200, { id: 'x' })
    await sendEmail({ RESEND_API_KEY: KEY, EMAIL_FROM: 'Games <games@example.org>' }, msg, f as unknown as typeof fetch)
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).from).toBe('Games <games@example.org>')
  })

  it('no key → not sent, no request, logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = fakeFetch(200, {})
    expect(await sendEmail({}, msg, f as unknown as typeof fetch)).toMatchObject({ ok: false })
    expect(f).not.toHaveBeenCalled()
    expect(err.mock.calls[0][0]).toMatch(/\[email\].*RESEND_API_KEY/)
  })

  it('Resend error → { ok: false } with Resend’s message logged, never the key', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = fakeFetch(403, { statusCode: 403, name: 'validation_error', message: 'You can only send testing emails to your own email address' })
    const r = await sendEmail({ RESEND_API_KEY: KEY }, msg, f as unknown as typeof fetch)
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('403') })
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toMatch(/own email address/)
    expect(logged).not.toContain(KEY)
  })

  it('network failure / timeout → { ok: false }, never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    await expect(sendEmail({ RESEND_API_KEY: KEY }, msg, f as unknown as typeof fetch)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('TimeoutError'),
    })
  })
})
