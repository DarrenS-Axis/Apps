// People and notifications: profiles with work emails (added by hand and
// from a CSV), work allocated to them from the Save / Allocate footer on a
// penetration, a defect and a piece of plant, and the Power Automate events
// that carry who to email — checked by standing in for the flow. Without a
// flow, allocating offers a pre-written email instead. The links in the
// events open the record, and "Allocated to you" lists the user's own work.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { createProject, onboard, tab } from './helpers.mjs'

const OUT = '/tmp/itp-shots-people'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.ITP_BASE_URL ?? 'http://127.0.0.1:4173'
const errors = []
const check = (ok, message) => {
  if (!ok) errors.push(message)
}

const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true })

// The Power Automate flow, stood in for: every event the app posts lands here.
const events = []
await page.route('**/__flow', async (route) => {
  events.push(JSON.parse(route.request().postData() ?? '{}'))
  await route.fulfill({ status: 202, body: '' })
})
const lastEvent = async (type) => {
  for (let i = 0; i < 40; i++) {
    const hit = events.filter((e) => e.event === type).at(-1)
    if (hit) return hit
    await page.waitForTimeout(150)
  }
  return undefined
}
const db = (store) =>
  page.evaluate(
    (s) =>
      new Promise((res) => {
        const r = indexedDB.open('hydraulic-itp')
        r.onsuccess = () => {
          const q = r.result.transaction(s).objectStore(s).getAll()
          q.onsuccess = () => res(q.result)
        }
      }),
    store,
  )
const foot = () => page.locator('.sheet__foot')
const allocate = async ({ name, email, due, note, label }) => {
  await foot().getByRole('button', { name: /^(Allocate to worker|Reallocate)$/ }).click()
  await foot().getByPlaceholder("Worker's name").fill(name)
  if (email !== undefined) await foot().getByPlaceholder('name@axisplumbing.com.au').fill(email)
  if (due) await foot().locator('label:has(span:text("Wanted by")) input').fill(due)
  if (note) await foot().getByPlaceholder('Optional').fill(note)
  await foot().getByRole('button', { name: `Allocate ${label}` }).click()
  await page.waitForTimeout(500)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await onboard(page, { name: 'Darren Shoobridge', state: 'NSW' })

// --- Settings: the flow URL (no SharePoint needed) and the people.
await page.getByRole('link', { name: 'Settings', exact: true }).click()
await page.waitForTimeout(400)
await page.locator('label:has(span:text("Power Automate flow URL")) input').fill(`${BASE}/__flow`)
await page.waitForTimeout(300)

await page.getByRole('button', { name: 'Add person' }).click()
await page.getByPlaceholder('e.g. Joe Bloggs').fill('Joe Bloggs')
await page.getByPlaceholder('joe.bloggs@axisplumbing.com.au').fill('Joe.Bloggs@axis.test')
await page.locator('.sheet label:has(span:text("Role")) select').selectOption('Plumber')
await foot().getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(400)

await page.getByRole('button', { name: 'Add person' }).click()
await page.getByPlaceholder('e.g. Joe Bloggs').fill('Sam Supervisor')
await page.getByPlaceholder('joe.bloggs@axisplumbing.com.au').fill('sam@axis.test')
await page.locator('.sheet label:has(span:text("Role")) select').selectOption('Supervisor')
check(await page.locator('.sheet label.check:has-text("Defects raised") input').isChecked(), 'A supervisor should default to hearing about defects raised')
await foot().getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(400)

const csvPath = path.join(OUT, 'people.csv')
fs.writeFileSync(csvPath, 'Name,Email,Role,Phone,State\nPriya QA,priya@axis.test,State QA,0400 000 000,NSW\nQuinn Queensland,quinn@axis.test,Supervisor,,QLD\nNo Email,,Plumber,,NSW\n')
await page.locator('input[aria-label="People CSV"]').setInputFiles(csvPath)
await page.locator('.toast', { hasText: '2 people added' }).waitFor()
let people = await db('people')
console.log('people:', people.map((p) => `${p.name} <${p.email}> ${p.state} [${p.notify.join(', ')}]`).join(' | '))
check(people.length === 4, `Expected 4 people, got ${people.length}`)
check(people.find((p) => p.name === 'Joe Bloggs')?.email === 'joe.bloggs@axis.test', 'Email not stored in lower case')
check(people.find((p) => p.name === 'Quinn Queensland')?.state === 'QLD', 'CSV state column ignored')
await shot('01-people')

// A test notification goes to that one person.
await page.locator('.listitem', { hasText: 'Joe Bloggs' }).click()
await foot().getByRole('button', { name: 'Send test' }).click()
const test = await lastEvent('notification.test')
console.log('test event:', test?.notifyEmails)
check(test?.notifyEmails === 'joe.bloggs@axis.test', 'Test notification not addressed to Joe')
await page.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(300)

// --- A penetration allocated to Joe.
await page.getByRole('link', { name: 'Projects', exact: true }).click()
await page.waitForTimeout(400)
await createProject(page, { name: 'Liverpool Hospital', client: 'Lendlease' })
await tab(page, 'Firedoc').click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Add' }).click()
await page.getByPlaceholder('F0001').fill('F0001')
await page.getByRole('button', { name: 'Add' }).last().click()
await page.waitForTimeout(500)
await page.getByRole('heading', { name: 'Penetration F0001' }).waitFor()
check(await foot().getByRole('button', { name: 'Save' }).isVisible(), 'No Save button on the penetration')
await foot().getByRole('button', { name: 'Allocate to worker' }).click()
await foot().getByPlaceholder("Worker's name").fill('Joe Bloggs')
const autofilled = await foot().getByPlaceholder('name@axisplumbing.com.au').inputValue()
check(autofilled === 'joe.bloggs@axis.test', `Joe's email not filled from his profile: "${autofilled}"`)
await foot().locator('label:has(span:text("Wanted by")) input').fill('2099-10-01')
await foot().getByPlaceholder('Optional').fill('Collar before the pour')
await foot().getByRole('button', { name: 'Allocate F0001' }).click()
await page.waitForTimeout(500)
const notice = await page.locator('.recordfoot__notice').innerText()
console.log('notice:', notice)
check(/will be emailed at joe\.bloggs@axis\.test/.test(notice), 'Allocation did not say Joe will be emailed')
const penEvent = await lastEvent('penetration.allocated')
console.log('penetration event:', JSON.stringify({ to: penEvent?.notifyEmails, link: penEvent?.link, summary: penEvent?.summary }))
check(penEvent?.notifyEmails === 'joe.bloggs@axis.test', 'Penetration allocation not addressed to Joe')
check(/#\/project\/[^/]+\/firedoc\?open=pen_/.test(penEvent?.link ?? ''), 'Allocation event has no link to the penetration')
check(penEvent?.record?.due === '2099-10-01' && penEvent?.record?.note === 'Collar before the pour', 'Due date / note missing from the event')
const pen = (await db('penetrations'))[0]
check(pen.assignedTo === 'Joe Bloggs' && pen.assignedBy === 'Darren Shoobridge' && pen.assignDue === '2099-10-01', 'Allocation not stored on the penetration')
await shot('02-allocated')
// Save closes the sheet and says so.
await foot().getByRole('button', { name: 'Save' }).click()
await page.locator('.toast', { hasText: 'F0001 saved' }).waitFor()
check((await page.locator('.sheet').count()) === 0, 'Save did not close the sheet')
check((await page.locator('.listitem', { hasText: '→ Joe Bloggs' }).count()) === 1, 'Penetration list does not show who it is allocated to')

// --- A defect raised: the supervisor who asked for defects hears about it; Queensland does not.
await tab(page, 'Reviewdoc').click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Raise' }).click()
await page.getByPlaceholder(/High top installed/).fill('CW: Rod extension sockets required at slab insulation.')
await page.getByRole('button', { name: 'Raise defect' }).click()
await page.waitForTimeout(600)
const raised = await lastEvent('defect.raised')
console.log('defect raised to:', raised?.notifyEmails)
check(/sam@axis\.test/.test(raised?.notifyEmails ?? '') && /priya@axis\.test/.test(raised?.notifyEmails ?? ''), 'Subscribed NSW people not told of the defect')
check(!/quinn@axis\.test|joe\.bloggs/.test(raised?.notifyEmails ?? ''), 'Defect sent to people who did not ask or are in another state')

// Allocated to someone new: they become a profile.
await page.getByRole('heading', { name: /^Defect / }).waitFor()
await allocate({ name: 'Kim Newhire', email: 'kim@axis.test', label: '0001' })
people = await db('people')
check(people.some((p) => p.name === 'Kim Newhire' && p.email === 'kim@axis.test'), 'A new worker with an email was not saved as a person')
check((await lastEvent('defect.allocated'))?.notifyEmails === 'kim@axis.test', 'Defect allocation not addressed to Kim')
await page.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(300)

// --- With no flow set up, allocating offers the email from the phone's mail app instead.
await page.getByRole('link', { name: /Settings/ }).first().click()
await page.waitForTimeout(400)
await page.locator('label:has(span:text("Power Automate flow URL")) input').fill('')
await page.waitForTimeout(300)
const before = events.length
await page.goto(`${BASE}/#/plant`)
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Add item' }).click()
await page.getByPlaceholder('e.g. Hammer Drill').fill('Hammer Drill')
await page.getByRole('button', { name: 'Add to register' }).click()
await page.getByRole('heading', { name: 'NSW-0001 · Hammer Drill' }).waitFor()
await allocate({ name: 'Joe Bloggs', label: 'NSW-0001' })
const plantNotice = await page.locator('.recordfoot__notice').innerText()
const mailto = await page.locator('.recordfoot__mail').getAttribute('href')
console.log('no flow:', plantNotice, '|', decodeURIComponent(mailto ?? '').slice(0, 120))
check(/No notification flow is set up/.test(plantNotice), 'No-flow allocation did not offer the email')
check(mailto?.startsWith('mailto:joe.bloggs%40axis.test?subject=') && decodeURIComponent(mailto).includes('#/plant/item/NSW-0001'), 'Mail link wrong')
check(events.length === before, 'An event was posted with no flow configured')
const drill = (await db('plant'))[0]
check(drill.assignedTo === 'Joe Bloggs' && /Allocated to Joe Bloggs/.test(drill.history.at(-1).note), 'Plant allocation not in its history')
// Now take it back, then give it to the user themselves.
await foot().getByRole('button', { name: 'Reallocate' }).click()
await foot().getByRole('button', { name: 'Take back from Joe Bloggs' }).click()
await page.waitForTimeout(400)
check(!(await db('plant'))[0].assignedTo, 'Take back did not clear the allocation')
await allocate({ name: 'Darren Shoobridge', email: '', label: 'NSW-0001' })
await page.locator('.sheet__head .iconbtn').click()
await page.waitForTimeout(300)

// --- "Allocated to you" on the home screen opens the item — without counting as a sighting.
await page.goto(`${BASE}/#/state`)
await page.waitForTimeout(600)
await page.getByText('Allocated to you').waitFor()
await shot('03-my-work')
await page.locator('.listitem', { hasText: 'NSW-0001 · Hammer Drill' }).click()
await page.getByRole('heading', { name: 'NSW-0001 · Hammer Drill' }).waitFor()
check(!(await db('plant'))[0].seenAt, 'Opening from "Allocated to you" was counted as a sighting')
await page.locator('.sheet__head .iconbtn').click()

// --- The link in an event opens the record.
await page.goto(penEvent.link.replace(/^https?:\/\/[^/]+\/?/, `${BASE}/`))
await page.getByRole('heading', { name: 'Penetration F0001' }).waitFor({ timeout: 10000 })
console.log('event link opened Penetration F0001')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'People and notifications check passed.')
process.exit(errors.length ? 1 : 0)
