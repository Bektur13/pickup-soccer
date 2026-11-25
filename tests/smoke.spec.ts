import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests:
 *   - '/'      → no landing page: it redirects straight to the map (/home),
 *                keeping any query string.
 *   - '/home'  → the map (under src/pages/(app)/): the providers mount, the
 *                nav renders, and the records WebSocket connects.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  // There is no landing page: opening the app's link goes straight to the map.
  // (The link-preview tags on "/" are checked in src/prerender-entry.test.tsx,
  // since "/" leaves for /home before a browser test could read them.)
  test('opening the link goes straight to the map, without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await page.waitForURL('**/home', { timeout: 15000 })
    await waitForApp(page)
    await expect(page.getByTestId('home-map')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('app-navigation')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('a query string survives the redirect (e.g. a shared ?create=1)', async ({ page }) => {
    await page.goto('/?create=1')
    await page.waitForURL('**/home?create=1', { timeout: 15000 })
  })

  test('dynamic app boundary mounts on /home', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('sign-in button visible when logged out', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})
