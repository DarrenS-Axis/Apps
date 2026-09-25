import { logoFor } from '../data/libraries/logos'
import { useBusinessUnit, useBusinessUnits, useProject, useSettings } from '../data/store'
import type { BusinessUnit, StateCode } from '../data/types'

/**
 * Which business the screen belongs to: the open project's unit, otherwise
 * the person's own unit (the first they chose) or their state's first.
 */
export function useBrand(projectId?: string): { unit?: BusinessUnit; logo?: string; name: string } {
  const settings = useSettings()
  const project = useProject(projectId)
  const projectUnit = useBusinessUnit(project?.businessUnitId)
  const units = useBusinessUnits(settings.state)
  const own = units.find((u) => settings.businessUnitIds.includes(u.id)) ?? units.find((u) => logoFor(u)) ?? units[0]
  const unit = project ? projectUnit : own
  const state: StateCode | undefined = project?.state ?? settings.state
  return { unit, logo: logoFor(unit ?? null, state), name: unit?.entity ?? 'Axis' }
}

/** A business's logo on a white tile, or the AXIS wordmark while it has none. */
export function BrandLogo({ logo, name, size = 'md', className = '' }: { logo?: string; name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  if (!logo) {
    return (
      <span className={`brandlogo brandlogo--${size} brandlogo--text ${className}`} aria-label={name} title={name}>
        AXIS
      </span>
    )
  }
  return (
    <span className={`brandlogo brandlogo--${size} ${className}`} title={name}>
      <img src={logo} alt={`${name} logo`} />
    </span>
  )
}

/** A unit's logo by id. */
export function UnitLogo({ unit, size = 'md' }: { unit: BusinessUnit; size?: 'sm' | 'md' | 'lg' }) {
  return <BrandLogo logo={logoFor(unit)} name={unit.entity} size={size} />
}
