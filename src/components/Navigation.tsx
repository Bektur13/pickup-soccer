/**
 * Top nav — a transparent overlay, so the map fills the whole screen:
 *   - top left: a small see-through pill with the app name + nav.ts links
 *     (Home, Settings; a menu button on phones)
 *   - top right: the account (avatar + name → sign out) or "Sign in"
 * Nothing else is drawn between them. On the map page, the search bar and the
 * "Create game" button sit under the account (home.tsx).
 *
 * Keep the data-testid hooks (`app-navigation`, `nav-sign-in-button`,
 * `nav-user-name`, `nav-user-email`) — the shipped tests rely on them.
 * `nav-user-email` is the one that carries an identity the test can check
 * exactly: a display name is optional, the email is the credential the
 * session was opened with.
 */

import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, signOut } from 'deepspace'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { APP_NAME } from '../constants'
import type { Role } from '../constants'
import { nav } from '../nav'
import { cn } from '../lib/utils'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'

/** The light, see-through "glass" used by every floating control on the map. */
const GLASS = 'border border-border/70 bg-card/75 shadow-sm backdrop-blur-md'

export default function Navigation() {
  const { isLoaded, isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const profileReady = !isSignedIn || (!userLoading && !!user)
  const userRole = (user?.role ?? 'anonymous') as Role | 'anonymous'

  // Close the mobile menu when navigating
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const visibleNav = nav.filter((item) => {
    if (item.devOnly && !import.meta.env.DEV) return false
    if (!item.roles) return true
    if (!profileReady) return false
    if (userRole === 'admin') return true
    return item.roles.includes(userRole as Role)
  })

  const navLink = (item: (typeof nav)[number]) => {
    const active = location.pathname.startsWith(item.path)
    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'rounded-full px-3 py-1 text-sm transition-colors',
          active ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <>
      {/* The bar itself is invisible and lets clicks through to the map;
          only the two clusters below catch the pointer. */}
      <nav
        data-testid="app-navigation"
        className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-2 p-2"
      >
        {/* Top left: app name + links */}
        <div className="pointer-events-auto relative">
          <div className={cn('flex items-center gap-0.5 rounded-full py-1 pl-3 pr-1', GLASS)}>
            <Link to="/home" className="pr-2 text-sm font-semibold text-foreground">
              {APP_NAME}
            </Link>
            <div className="hidden items-center gap-0.5 md:flex">{visibleNav.map(navLink)}</div>
            <button
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          {mobileMenuOpen && (
            <div
              className={cn(
                'absolute left-0 top-[calc(100%+6px)] flex min-w-40 flex-col gap-0.5 rounded-2xl p-1 md:hidden',
                GLASS,
                'bg-card/95',
              )}
            >
              {visibleNav.map(navLink)}
            </div>
          )}
        </div>

        {/* Top right: account */}
        <div className="pointer-events-auto">
          {!isLoaded ? null : isSignedIn && !profileReady ? (
            /* Signed in, profile still loading — skeleton pill, never the
               Sign in button (that would offer sign-in to a signed-in user). */
            <div className={cn('flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5', GLASS)}>
              <div className="h-6 w-6 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded-md bg-muted sm:w-20" />
            </div>
          ) : isSignedIn && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    aria-label="Account menu"
                    className={cn(
                      'group flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 text-sm transition-colors hover:bg-card',
                      GLASS,
                    )}
                  >
                    <Avatar className="h-6 w-6 ring-1 ring-inset ring-border">
                      <AvatarImage src={user.imageUrl ?? undefined} referrerPolicy="no-referrer" />
                      <AvatarFallback className="text-[11px]">
                        {(user.name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      data-testid="nav-user-name"
                      className="max-w-[96px] truncate text-foreground sm:max-w-[160px]"
                    >
                      {user.name || user.email}
                    </span>
                    <ChevronDown
                      className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 group-data-[popup-open]:rotate-180"
                      aria-hidden
                    />
                  </button>
                }
              />
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="truncate font-medium text-foreground">
                    {user.name || 'Signed in'}
                  </div>
                  <div
                    data-testid="nav-user-email"
                    className="truncate text-xs font-normal text-muted-foreground"
                  >
                    {user.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut aria-hidden />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              data-testid="nav-sign-in-button"
              onClick={() => setShowAuthModal(true)}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90"
            >
              Sign in
            </button>
          )}
        </div>
      </nav>

      {/* Google is the only OAuth button; the SDK always adds email/password
          below it (sign-in only — used by @deepspace.test test accounts). */}
      {showAuthModal && (
        <AuthOverlay providers={['google']} onClose={() => setShowAuthModal(false)} />
      )}
    </>
  )
}
