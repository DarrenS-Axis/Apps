// Proves the claim the whole app rests on: that it keeps working in a trench
// with no signal. Requires a production build served over a secure context
// (https or localhost) — the service worker does not register otherwise.
import { chromium } from 'playwright'
import fs from 'node:fs'

fs.mkdirSync('/tmp/itp-shots-offline', { recursive: true })

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const errors = []
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })

// Wait for the service worker to take control.
const swState = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  const reg = await navigator.serviceWorker.ready
  return reg.active ? reg.active.state : 'no-active-worker'
})
console.log('service worker:', swState)
if (swState !== 'activated') errors.push(`Service worker did not activate (${swState})`)

// The shell must be *precached*, not merely reachable. Relying on the HTTP
// cache would look identical here but is evictable, so a cold start on site
// could land on a blank page. Assert the bundle is actually in the SW cache.
const cached = await page.evaluate(async () => {
  const keys = await caches.keys()
  const names = []
  for (const key of keys) {
    const cache = await caches.open(key)
    for (const req of await cache.keys()) names.push(new URL(req.url).pathname)
  }
  return names
})
const hasJs = cached.some((n) => /\/assets\/.*\.js$/.test(n))
const hasCss = cached.some((n) => /\/assets\/.*\.css$/.test(n))
console.log('precached assets:', cached.filter((n) => n.includes('/assets/')).length, 'js:', hasJs, 'css:', hasCss)
if (!hasJs) errors.push('No JS bundle was precached — a cold offline start would render nothing')
if (!hasCss) errors.push('No stylesheet was precached — a cold offline start would render unstyled')

// Create a job so there is state to survive the offline reload.
await page.getByRole('button', { name: 'New job' }).click()
await page.getByPlaceholder('e.g. Minus 1 — Adelaide').fill('Offline Test Job')
await page.getByRole('button', { name: 'Create job' }).click()
await page.waitForTimeout(800)

// Cut the network entirely, then reload.
await ctx.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const heading = await page.locator('.appbar__title h1').textContent()
console.log('after offline reload, header shows:', JSON.stringify(heading))
if (!heading?.includes('Offline Test Job')) {
  errors.push(`App did not come back offline with its data (header: ${heading})`)
}

// The register must still be usable with no network.
await page.getByRole('link', { name: 'ITPs' }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: /ITP register/ }).click()
await page.waitForTimeout(600)
const rows = await page.locator('.listitem').count()
console.log('templates available offline:', rows)
if (rows !== 42) errors.push(`Expected 42 templates offline, got ${rows}`)

await page.screenshot({ path: '/tmp/itp-shots-offline/after-offline-reload.png', fullPage: false })
await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'Offline check passed.')
process.exit(errors.length ? 1 : 0)
