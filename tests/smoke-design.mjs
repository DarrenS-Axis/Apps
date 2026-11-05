// The Design tab: Axis MEP Design inside the QA app. The tool loads under the
// app's header and tab bar, works there (the demo solves), opens full screen,
// and the service worker never stores the tool's page as the QA app's shell.
import { chromium } from 'playwright'
import fs from 'node:fs'
import { onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-design'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const errors = []
const check = (ok, message) => {
  if (!ok) errors.push(message)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(e.message))
page.on('dialog', (d) => d.accept())

await page.goto(`${BASE}/`)
await onboard(page)

await tab(page, 'Design').click()
await page.waitForTimeout(800)
check(page.url().endsWith('#/design'), `Design tab opens #/design, got ${page.url()}`)
check((await page.locator('.appbar h1').textContent()) === 'MEP design', 'header names the design tool')
check(await tab(page, 'Design').evaluate((a) => a.classList.contains('active') || a.getAttribute('aria-current') === 'page'), 'Design tab is marked current')
const full = await page.getByRole('link', { name: 'Open full screen' }).getAttribute('href')
check(/mep\/index\.html$/.test(full ?? ''), `full-screen link points at the tool, got ${full}`)

// The tool itself, inside the frame.
const frame = page.frameLocator('iframe.design__frame')
await frame.locator('[data-cmd=demo]').click()
await page.waitForTimeout(500)
const summary = await frame.locator('#resultsPanel').textContent()
check(/Cold water/.test(summary) && /Natural gas/.test(summary) && /0 errors/.test(summary), `demo solves in the frame: ${summary.slice(0, 160)}`)
const box = await page.locator('iframe.design__frame').boundingBox()
check(box && box.height > 500, `frame fills the screen (height ${box?.height})`)
await page.screenshot({ path: `${OUT}/design-tab.png` })

// The rest of the app still works around it.
await tab(page, 'Projects').click()
await page.waitForTimeout(500)
check(page.url().endsWith('#/state'), 'back to Projects from Design')

// Offline shell: whatever the worker cached as index.html must be the QA app.
await page.evaluate(() => navigator.serviceWorker?.ready)
await page.reload()
await page.waitForTimeout(800)
await tab(page, 'Design').click()
await page.waitForTimeout(1200)
const shell = await page.evaluate(async () => {
  const keys = await caches.keys()
  for (const k of keys) {
    const hit = await (await caches.open(k)).match('./index.html', { ignoreVary: true })
    if (hit) return await hit.text()
  }
  return null
})
if (shell != null) check(!/Axis MEP Design/.test(shell) && /id="root"/.test(shell), 'cached app shell is the QA app, not the design tool')
const mepCached = await page.evaluate(async () => {
  for (const k of await caches.keys()) if (await (await caches.open(k)).match(new URL('mep/app.js', location.href).href, { ignoreVary: true })) return true
  return false
})
check(mepCached, 'design tool files are cached for offline use')

// The MSAL snippet at the top of index.html loads /msal-browser.min.js, which
// is not part of the build; its two errors are not this screen's to report.
const ours = consoleErrors.filter((m) => !/msal is not defined|Unexpected token '<'/.test(m))
check(!ours.length, `page errors: ${ours.join(' | ')}`)
await browser.close()
if (errors.length) {
  console.error('FAIL smoke-design\n  ' + errors.join('\n  '))
  process.exit(1)
}
console.log('ok smoke-design')
