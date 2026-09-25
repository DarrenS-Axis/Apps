import type { BusinessUnit, Depot, StateCode } from '../types'

/**
 * The business units seeded on first run, taken from the "BUSINESS UNIT
 * (STATE/OFFICE)" column of the September 2024 QA reports plus the offices on
 * the Axis letterhead. They are ordinary records once created — rename, add
 * or retire them in Settings — and only the ids here are fixed so a project
 * imported from another device lands in the same unit.
 */
export const SEED_BUSINESS_UNITS: Omit<BusinessUnit, 'createdAt' | 'updatedAt'>[] = [
  { id: 'bu_nsw_major', state: 'NSW', name: 'NSW Major Works', entity: 'Axis Plumbing NSW Group', office: 'Sydney' },
  { id: 'bu_nsw_small', state: 'NSW', name: 'NSW Small Works', entity: 'Axis Plumbing Small Works Group', office: 'Sydney' },
  { id: 'bu_nsw_medgas', state: 'NSW', name: 'NSW Med Gas', entity: 'Axis Plumbing NSW Group', office: 'Sydney' },
  { id: 'bu_act', state: 'ACT', name: 'ACT', entity: 'Axis Plumbing ACT', office: 'Canberra' },
  { id: 'bu_qld', state: 'QLD', name: 'QLD', entity: 'Axis Plumbing QLD', office: 'Brisbane' },
  { id: 'bu_vic', state: 'VIC', name: 'VIC', entity: 'Axis Services VIC', office: 'Melbourne' },
  { id: 'bu_nt', state: 'NT', name: 'NT', entity: 'Axis Plumbing NT', office: 'Darwin' },
  { id: 'bu_wa', state: 'WA', name: 'WA', entity: 'Axis Services Group WA', office: 'Perth' },
  { id: 'bu_sa', state: 'SA', name: 'SA', entity: 'Axis Services SA', office: 'Beverley' },
  { id: 'bu_nz', state: 'NZ', name: 'NZ', entity: 'Axis Plumbing NZ', office: 'New Zealand' },
]

/**
 * Trading names the first releases seeded, since corrected to the names on
 * each business's logo. A unit still carrying one of these (and never edited)
 * is brought up to date; one someone has renamed is left alone.
 */
export const SUPERSEDED_ENTITIES: Record<string, string> = {
  bu_nsw_major: 'Axis Plumbing NSW',
  bu_nsw_small: 'Axis Plumbing NSW',
  bu_nsw_medgas: 'Axis Plumbing NSW',
  bu_act: 'Axis Plumbing NSW',
  bu_vic: 'Axis Plumbing VIC',
  bu_wa: 'Axis Plumbing WA',
}

/**
 * Yards and offices the plant register tracks items back to. The position is
 * the suburb only until the address is looked up or someone sets it while
 * standing there — `source: 'seed'` marks that, and the match is generous
 * until then.
 */
export const SEED_DEPOTS: Omit<Depot, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'dep_sa_beverley',
    state: 'SA',
    name: 'Beverley office & yard',
    address: 'Unit 2/21 Alfred Ave, Beverley SA 5009',
    lat: -34.8955,
    lng: 138.544,
    radius: 250,
    source: 'seed',
    defaultArea: 'Yard',
  },
]

export const unitsForState = (units: BusinessUnit[], state?: StateCode): BusinessUnit[] =>
  state ? units.filter((u) => u.state === state) : units
