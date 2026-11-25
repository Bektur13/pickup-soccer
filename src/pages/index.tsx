/**
 * "/" — opens straight into the map. There's no landing page: this route
 * immediately replaces itself with /home (the live map, under src/pages/(app)/).
 *
 * It stays a top-level STATIC page on purpose: it's prerendered at build
 * (prerender.ts) with the <Seo> tags from src/seo.ts, so a shared link still
 * gets a proper title/description/preview, and it makes no auth request or
 * WebSocket of its own — the map page does that after the redirect.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

export default function Landing() {
  const navigate = useNavigate()

  useEffect(() => {
    // Keep any query string (e.g. a shared ?create=1).
    navigate({ pathname: '/home', search: window.location.search }, { replace: true })
  }, [navigate])

  return (
    <>
      <Seo {...seo} path="/" />
      <div
        data-testid="static-landing"
        className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground"
      >
        <p>
          Opening the map…
          <noscript>
            {' '}
            <a href="/home" className="underline">
              Open the map
            </a>
          </noscript>
        </p>
      </div>
    </>
  )
}
