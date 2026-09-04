import type { ItpTemplate, TemplateGroup } from '../types'
import { belowGroundTemplates } from './belowGround'
import { aboveGroundTemplates } from './aboveGround'
import { plantTemplates } from './plant'

/**
 * The hydraulic ITP register — templates 001 to 042.
 *
 * Every template is a starting point: once an ITP is raised from a template the
 * instance owns its own copy of the schedule, so item wording, acceptance
 * criteria and inspection point types can be tuned for the project without
 * affecting the register.
 */
export const TEMPLATES: ItpTemplate[] = [
  ...belowGroundTemplates,
  ...aboveGroundTemplates,
  ...plantTemplates,
].sort((a, b) => a.code.localeCompare(b.code))

const byCode = new Map(TEMPLATES.map((t) => [t.code, t]))

export const getTemplate = (code: string): ItpTemplate | undefined => byCode.get(code)

export const templatesByGroup = (group: TemplateGroup): ItpTemplate[] =>
  TEMPLATES.filter((t) => t.group === group)

/** Case-insensitive search over code, title, scope and standards. */
export function searchTemplates(query: string): ItpTemplate[] {
  const q = query.trim().toLowerCase()
  if (!q) return TEMPLATES
  return TEMPLATES.filter((t) =>
    [t.code, t.title, t.scope, t.group, ...t.standards].join(' ').toLowerCase().includes(q),
  )
}

/** Count of hold and witness points in a template, shown in the register. */
export function templatePointCounts(t: ItpTemplate): { H: number; W: number; S: number; X: number } {
  const counts = { H: 0, W: 0, S: 0, X: 0 }
  for (const i of t.items) counts[i.point] += 1
  return counts
}
