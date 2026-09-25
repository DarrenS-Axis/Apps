import { db } from '../data/db'
import { logoDataUrl, logoFor } from '../data/libraries/logos'
import type { Project } from '../data/types'

/**
 * The project as the PDFs should print it: with the Axis logo in the
 * contractor cell. A logo uploaded on the project wins; otherwise the
 * business unit's (and so the state's) goes in automatically.
 */
export async function withAxisLogo(project: Project): Promise<Project> {
  if (project.contractorLogo) return project
  const unit = await db.businessUnits.get(project.businessUnitId)
  const logo = await logoDataUrl(logoFor(unit ?? null, project.state))
  return logo ? { ...project, contractorLogo: logo } : project
}
