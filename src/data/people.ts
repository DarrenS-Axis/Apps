import { db, now, uid } from './db'
import { defaultNotify, type NotifyKey, type Person, type StateCode } from './types'

/**
 * People: the profiles work is allocated to and notifications are sent to.
 * Names are how the paper forms and the app have always recorded who did
 * what, so a profile is found by its name as well as its email.
 */

export type NewPerson = Omit<Person, 'id' | 'createdAt' | 'updatedAt' | 'notify' | 'active'> & Partial<Pick<Person, 'notify' | 'active'>>

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

export async function createPerson(input: NewPerson): Promise<Person> {
  const p: Person = {
    ...input,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    notify: input.notify ?? defaultNotify(input.role),
    active: input.active ?? true,
    id: uid('per'),
    createdAt: now(),
    updatedAt: now(),
  }
  await db.people.add(p)
  return p
}

export async function updatePerson(id: string, patch: Partial<Person>): Promise<void> {
  const clean = { ...patch }
  if (clean.email !== undefined) clean.email = clean.email.trim().toLowerCase()
  if (clean.name !== undefined) clean.name = clean.name.trim()
  await db.people.update(id, { ...clean, updatedAt: now() })
}

export async function deletePerson(id: string): Promise<void> {
  await db.people.delete(id)
}

/** The profile behind a name or an email, if there is one. */
export async function findPerson(nameOrEmail: string): Promise<Person | undefined> {
  const key = nameOrEmail.trim().toLowerCase()
  if (!key) return undefined
  const all = await db.people.toArray()
  return all.find((p) => p.email === key) ?? all.find((p) => p.name.toLowerCase() === key)
}

/**
 * Who is told about an event: people in the state (or on every state) who
 * asked for it, plus — for an allocation — the person it was handed to.
 * Inactive profiles and profiles with no email are left out.
 */
export async function recipientsFor(key: NotifyKey | string, state: StateCode | string | undefined, assignee?: { name?: string; email?: string }): Promise<{ name: string; email: string; why: string }[]> {
  const out = new Map<string, { name: string; email: string; why: string }>()
  const people = (await db.people.toArray()).filter((p) => p.active && p.email)
  if (assignee?.name || assignee?.email) {
    const match = people.find((p) => (assignee.email && p.email === assignee.email.toLowerCase()) || (assignee.name && p.name.toLowerCase() === assignee.name.trim().toLowerCase()))
    const email = (assignee.email || match?.email || '').toLowerCase()
    // A profile that has turned allocation emails off is respected (a test
    // always goes); someone with no profile gets told.
    if (email && (!match || key === 'notification.test' || match.notify.includes('allocated'))) out.set(email, { name: match?.name ?? assignee.name ?? email, email, why: 'allocated to them' })
  }
  const eventKey = key.endsWith('.allocated') || key === 'notification.test' ? null : (key as NotifyKey)
  if (eventKey) {
    for (const p of people) {
      if (!p.notify.includes(eventKey)) continue
      if (!p.allStates && state && p.state !== state) continue
      if (!out.has(p.email)) out.set(p.email, { name: p.name, email: p.email, why: 'subscribed' })
    }
  }
  return [...out.values()]
}
