import act from '../../assets/logos/act.png'
import nt from '../../assets/logos/nt.png'
import nz from '../../assets/logos/nz.png'
import sa from '../../assets/logos/sa.png'
import vic from '../../assets/logos/vic.png'
import type { BusinessUnit, StateCode } from '../types'

/**
 * Each business's logo, as supplied. A unit shows, in order: the logo
 * uploaded for it in Settings, the one built in here for that unit, then its
 * state's. Units with none yet — add them in Settings → Business units, or
 * drop the file in src/assets/logos and list it below.
 */
export const UNIT_LOGOS: Record<string, string> = {
  bu_act: act,
  bu_nt: nt,
  bu_nz: nz,
  bu_sa: sa,
  bu_vic: vic,
}

export const STATE_LOGOS: Partial<Record<StateCode, string>> = {
  ACT: act,
  NT: nt,
  NZ: nz,
  SA: sa,
  VIC: vic,
}

/** The logo to show for a business unit (or, with no unit, a state). */
export function logoFor(unit?: Pick<BusinessUnit, 'id' | 'state' | 'logo'> | null, state?: StateCode): string | undefined {
  if (unit?.logo) return unit.logo
  if (unit && UNIT_LOGOS[unit.id]) return UNIT_LOGOS[unit.id]
  const s = unit?.state ?? state
  return s ? STATE_LOGOS[s] : undefined
}

const cache = new Map<string, Promise<string | undefined>>()

/** The same logo as a data URL, which is what jsPDF draws. */
export function logoDataUrl(src?: string): Promise<string | undefined> {
  if (!src) return Promise.resolve(undefined)
  if (src.startsWith('data:')) return Promise.resolve(src)
  let hit = cache.get(src)
  if (!hit) {
    hit = fetch(src)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(
        (blob) =>
          new Promise<string | undefined>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => resolve(undefined)
            reader.readAsDataURL(blob)
          }),
      )
      .catch(() => undefined)
    cache.set(src, hit)
  }
  return hit
}
