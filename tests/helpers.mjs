// Shared steps for the browser suites: the first-run screen and a project.
// Every suite used to start with "New job"; the app now asks who you are and
// which state you work in first, and projects sit under a business unit.

/** Completes the welcome screen as an NSW site user. */
export async function onboard(page, { name = 'Brett Patman', state = 'NSW', role } = {}) {
  await page.getByPlaceholder('e.g. Murtaza Bahloli').fill(name)
  if (role) await page.locator('label:has(span:text("Role")) select').selectOption({ label: role })
  await page.locator('label:has(span:text("State")) select').selectOption(state)
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Open .*projects/ }).click()
  await page.waitForTimeout(900)
}

/** Creates a project in the first business unit and lands on its hub. */
export async function createProject(page, fields) {
  await page.getByRole('button', { name: 'New project' }).first().click()
  await page.getByPlaceholder('e.g. Liverpool Hospital').fill(fields.name)
  if (fields.projectNumber) await page.getByPlaceholder('21-005FCR').fill(fields.projectNumber)
  if (fields.client) await page.getByPlaceholder('Lendlease').fill(fields.client)
  if (fields.approvedBy) await page.locator('label:has(span:text("ITPs approved for use by")) input').fill(fields.approvedBy)
  if (fields.address) await page.locator('label:has(span:text("Project address")) input').fill(fields.address)
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.waitForTimeout(800)
}

/** The project-scoped tabs, unambiguous against same-named links on the page. */
export const tab = (page, name) => page.locator('.tabbar').getByRole('link', { name, exact: true })

/** Opens the Photos screen from the project hub. */
export async function openPhotos(page) {
  await tab(page, 'Project').click()
  await page.waitForTimeout(400)
  await page.getByRole('link', { name: /^Photos/ }).click()
  await page.waitForTimeout(600)
}
