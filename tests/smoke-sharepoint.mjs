// SharePoint sync, end to end, against the mock Graph server in
// mock-graph.mjs: provision the lists, write records on one device and push
// them, pull them onto a fresh device, and confirm a state sees only its own.
import { chromium } from 'playwright'
import { startMockGraph } from './mock-graph.mjs'

const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const GRAPH_PORT = 4180
const errors = []
const mock = await startMockGraph(GRAPH_PORT)
const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })

const graphState = async () => (await fetch(`http://127.0.0.1:${GRAPH_PORT}/__state`)).json()

async function device(name, { state, role = 'Site' }) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`) })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.getByPlaceholder('e.g. Murtaza Bahloli').fill(name)
  await page.locator('label:has(span:text("Role")) select').selectOption({ label: role })
  await page.locator('label:has(span:text("State")) select').selectOption(state)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Open .*projects/ }).click()
  await page.waitForTimeout(900)
  console.log(`${name}: after welcome at ${new URL(page.url()).hash}`)

  // Point the app at the mock server.
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.waitForTimeout(500)
  await page.locator('label:has-text("Sync to SharePoint") input').click()
  await page.waitForTimeout(300)
  await page.getByPlaceholder(/sharepoint\.com\/sites\/QA/).fill('https://axisplumbing.sharepoint.com/sites/QA')
  await page.getByRole('button', { name: 'Show advanced' }).click()
  await page.locator('label:has(span:text("Graph endpoint override")) input').fill(`http://127.0.0.1:${GRAPH_PORT}/v1.0`)
  await page.locator('label:has(span:text("Fixed bearer token")) input').fill('test-token')
  await page.waitForTimeout(400)
  return { ctx, page }
}

const toastText = async (page) => {
  await page.waitForTimeout(400)
  return (await page.locator('.toast').allInnerTexts()).join(' ')
}

// ---- Device A: NSW site, provisions and pushes.
const a = await device('Murtaza Bahloli', { state: 'NSW' })
await a.page.getByRole('button', { name: /Provision SharePoint lists/ }).click()
await a.page.waitForTimeout(1500)
console.log('provision:', await toastText(a.page))
let g = await graphState()
console.log('lists on site:', g.lists.map((l) => l.displayName).join(', '))
if (g.lists.length !== 10) errors.push(`Expected 10 lists (9 + library), got ${g.lists.length}`)

await a.page.getByRole('link', { name: 'Projects', exact: true }).click()
await a.page.waitForTimeout(500)
await a.page.getByRole('button', { name: 'New project' }).first().click()
await a.page.getByPlaceholder('e.g. Liverpool Hospital').fill('Liverpool Hospital')
await a.page.getByPlaceholder('Lendlease').fill('Lendlease')
await a.page.getByRole('button', { name: 'Create project' }).click()
await a.page.waitForTimeout(800)
await a.page.locator('.tabbar').getByRole('link', { name: 'Firedoc' }).click()
await a.page.waitForTimeout(400)
await a.page.getByRole('button', { name: 'Add' }).click()
await a.page.getByPlaceholder('F0001').fill('F0001')
await a.page.getByRole('button', { name: 'Add' }).last().click()
await a.page.waitForTimeout(500)
await a.page.locator('.sheet__head .iconbtn').last().click()
await a.page.locator('.tabbar').getByRole('link', { name: 'Reviewdoc' }).click()
await a.page.waitForTimeout(400)
await a.page.getByRole('button', { name: 'Raise' }).click()
await a.page.getByPlaceholder(/High top installed/).fill('CW: Rod extension sockets required at slab insulation.')
await a.page.getByPlaceholder('500').fill('500')
await a.page.getByRole('button', { name: 'Raise defect' }).click()
await a.page.waitForTimeout(500)
await a.page.locator('.sheet__head .iconbtn').last().click()
await a.page.locator('.tabbar').getByRole('link', { name: 'Controldoc' }).click()
await a.page.waitForTimeout(400)
await a.page.getByRole('button', { name: /ITP register/ }).click()
await a.page.getByPlaceholder(/Search the \d+/).fill('023')
await a.page.waitForTimeout(300)
await a.page.locator('.listitem').first().click()
await a.page.getByPlaceholder(/North East Corner/).fill('Level 20 cold water')
await a.page.getByRole('button', { name: 'Raise ITP' }).click()
await a.page.waitForTimeout(800)

// A tool on the NSW plant register.
await a.page.goto(`${BASE}/#/plant`)
await a.page.waitForTimeout(600)
await a.page.getByRole('button', { name: 'Add item' }).click()
await a.page.getByPlaceholder('e.g. Hammer Drill').fill('Hammer Drill')
await a.page.getByRole('button', { name: 'Add to register' }).click()
await a.page.waitForTimeout(600)
await a.page.locator('.sheet__head .iconbtn').last().click()

await a.page.getByRole('link', { name: 'Settings', exact: true }).click()
await a.page.waitForTimeout(500)
await a.page.getByRole('button', { name: 'Sync now' }).click()
await a.page.waitForTimeout(2500)
console.log('sync A:', await toastText(a.page))
g = await graphState()
const count = (name) => g.items.filter((i) => i.listId === g.lists.find((l) => l.displayName === name)?.id).length
console.log('items:', ['QA Business Units', 'QA Projects', 'QA ITPs', 'QA Penetrations', 'QA Defects', 'QA Plant', 'QA Depots'].map((n) => `${n}=${count(n)}`).join(' '))
const plantItem = g.items.find((i) => i.listId === g.lists.find((l) => l.displayName === 'QA Plant')?.id)
if (count('QA Plant') !== 1 || plantItem?.fields.State !== 'NSW' || plantItem?.fields.PlantNo !== 'NSW-0001') errors.push('Plant item did not reach SharePoint as NSW-0001')
if (count('QA Depots') !== 0) errors.push('Untouched seed depots should not be uploaded')
if (count('QA Projects') !== 1) errors.push('Project did not reach SharePoint')
if (count('QA ITPs') !== 1) errors.push('ITP did not reach SharePoint')
if (count('QA Penetrations') !== 1) errors.push('Penetration did not reach SharePoint')
if (count('QA Defects') !== 1) errors.push('Defect did not reach SharePoint')
if (count('QA Business Units') !== 0) errors.push('Untouched seed business units should not be uploaded')
const itpItem = g.items.find((i) => i.listId === g.lists.find((l) => l.displayName === 'QA ITPs')?.id)
console.log('ITP fields:', JSON.stringify({ State: itpItem?.fields.State, ItcNumber: itpItem?.fields.ItcNumber, Status: itpItem?.fields.Status, Title: itpItem?.fields.Title }))
if (itpItem?.fields.State !== 'NSW') errors.push('ITP list item not stamped with its state')
if (itpItem?.fields.ItcNumber !== '000001') errors.push(`ITC number should be 000001, got ${itpItem?.fields.ItcNumber}`)

// A second sync sends nothing new.
await a.page.getByRole('button', { name: 'Sync now' }).click()
await a.page.waitForTimeout(1500)
const second = await toastText(a.page)
console.log('sync A again:', second)
if (!/0 sent/.test(second)) errors.push(`Second sync should send nothing: ${second}`)

// ---- Device B: fresh NSW device pulls everything.
const b = await device('Ben Kennedy', { state: 'NSW', role: 'State QA' })
await b.page.getByRole('button', { name: /Provision SharePoint lists|Re-check/ }).click()
await b.page.waitForTimeout(1200)
await b.page.getByRole('button', { name: 'Sync now' }).click()
await b.page.waitForTimeout(2500)
console.log('sync B:', await toastText(b.page))
await b.page.getByRole('link', { name: 'Projects', exact: true }).click()
await b.page.waitForTimeout(800)
const bProjects = await b.page.locator('.listitem').allInnerTexts()
console.log('device B sees:', bProjects.map((t) => t.replace(/\s+/g, ' ').slice(0, 80)))
if (!bProjects.some((t) => /Liverpool Hospital/.test(t))) errors.push('Fresh NSW device did not receive the project')
if (!bProjects.some((t) => /1 ITPs/.test(t) && /1 penetrations/.test(t) && /1 open defects/.test(t))) errors.push('Fresh NSW device is missing module records')
await b.page.goto(`${BASE}/#/plant`)
await b.page.waitForTimeout(600)
if (!(await b.page.locator('.listitem', { hasText: 'NSW-0001' }).count())) errors.push('Fresh NSW device did not receive the plant register')

// ---- Device C: QLD site sees nothing from NSW.
const c = await device('Sam Ortiz', { state: 'QLD' })
await c.page.getByRole('button', { name: /Provision SharePoint lists|Re-check/ }).click()
await c.page.waitForTimeout(1200)
await c.page.getByRole('button', { name: 'Sync now' }).click()
await c.page.waitForTimeout(2000)
console.log('sync C:', await toastText(c.page))
await c.page.getByRole('link', { name: 'Projects', exact: true }).click()
await c.page.waitForTimeout(600)
const cProjects = await c.page.locator('.listitem').count()
console.log('device C (QLD) sees', cProjects, 'projects')
if (cProjects !== 0) errors.push('A QLD device received NSW projects')
await c.page.goto(`${BASE}/#/plant`)
await c.page.waitForTimeout(600)
if (await c.page.locator('.listitem').count()) errors.push('A QLD device received NSW plant')

// ---- Device D: national QA in VIC sees NSW.
const d = await device('National QA', { state: 'VIC', role: 'National QA' })
await d.page.getByRole('button', { name: /Provision SharePoint lists|Re-check/ }).click()
await d.page.waitForTimeout(1200)
await d.page.getByRole('button', { name: 'Sync now' }).click()
await d.page.waitForTimeout(2000)
await d.page.getByRole('link', { name: 'Projects', exact: true }).click()
await d.page.waitForTimeout(600)
const dProjects = await d.page.locator('.listitem').allInnerTexts()
console.log('national QA sees:', dProjects.length, 'projects')
if (!dProjects.some((t) => /Liverpool Hospital/.test(t))) errors.push('National QA did not receive the NSW project')
await d.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'QA report' }).click()
await d.page.waitForTimeout(700)
const report = await d.page.locator('table.report').first().innerText()
if (!/Liverpool Hospital/.test(report)) errors.push('National report does not list the NSW project')
await d.page.screenshot({ path: '/tmp/itp-shots-qa/sp-national-report.png', fullPage: true })

await browser.close()
mock.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'SharePoint sync check passed.')
process.exit(errors.length ? 1 : 0)
