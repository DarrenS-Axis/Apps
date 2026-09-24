/**
 * The Controldoc ITP library register — the 43 hydraulic ITPs Axis runs
 * nationally, in the library's own numbering.
 *
 * From "Master Controldoc ITP Library 10_8_23.xlsx". The schedule content for
 * each lives in ../templates; this is the index the register is built from,
 * with the photograph minimums the library sets for every ITP.
 */
export interface ItpLibraryEntry {
  code: string
  title: string
  revision: string
  installationPhotos: number
  testingPhotos: number
  thirdPartyPages: number
}

export const LIBRARY_DATE = '10/08/2023'

export const ITP_LIBRARY: ItpLibraryEntry[] = [
  ['001', 'Inground Sanitary Drainage', 0],
  ['002', 'Inground Sewer Rising Main', 0],
  ['003', 'Inground Tradewaste Drainage', 0],
  ['004', 'Inground High Temperature Sanitary Drainage', 0],
  ['005', 'Inground Stormwater Drainage', 0],
  ['006', 'Inground Stormwater Rising Mains', 0],
  ['007', 'Inground Siphonic Drainage', 0],
  ['008', 'Inground Fuel and Stormwater Drainage', 0],
  ['009', 'Inground Potable Water', 0],
  ['010', 'Inground Non Drinking Water', 0],
  ['011', 'Inground Natural Gas', 0],
  ['012', 'Inground LPG Gas', 0],
  ['013', 'Inground Fire Hydrant Service', 0],
  ['014', 'Inground Fire Sprinkler Service', 0],
  ['015', 'Decks and Cast In Drainage', 0],
  ['016', 'Sanitary Plumbing', 0],
  ['017', 'Sewer Rising Main', 0],
  ['018', 'Tradewaste Drainage', 0],
  ['019', 'Stormwater Drainage', 0],
  ['020', 'Stormwater Rising Main', 0],
  ['021', 'Siphonic Drainage', 2],
  ['022', 'Fuel and Stormwater Drainage', 0],
  ['023', 'Potable Cold Water', 0],
  ['024', 'Non Drinking Water', 0],
  ['025', 'Hot Water Service', 0],
  ['026', 'Natural Gas', 0],
  ['027', 'LPG Gas', 0],
  ['028', 'Hot and Cold Water Rough-ins', 0],
  ['029', 'Fire Hydrant Service', 0],
  ['030', 'Sanitary Fixtures and Tapware', 0],
  ['031', 'Sewer Pumps and Holding Well', 2],
  ['032', 'Stormwater Pumps', 2],
  ['033', 'Fuel Oil Water Separator System', 1],
  ['034', 'Stormwater Filtration Device', 1],
  ['035', 'Rainwater Reuse System', 7],
  ['036', 'Potable Water Pumps', 4],
  ['037', 'Fire Hose Reel', 1],
  ['038', 'Fire Hydrant Pumps and System', 9],
  ['039', 'Hot Water Plant', 2],
  ['040', 'Reverse Osmosis Plant', 9],
  ['041', 'Potable Cold Water Tank', 13],
  ['042', 'Fire Service Water Tank', 13],
  ['043', 'Non Potable Water Tank', 13],
].map(([code, title, thirdPartyPages]) => ({
  code: code as string,
  title: title as string,
  revision: '2',
  installationPhotos: 2,
  testingPhotos: 2,
  thirdPartyPages: thirdPartyPages as number,
}))

export const libraryEntry = (code: string): ItpLibraryEntry | undefined => ITP_LIBRARY.find((e) => e.code === code)

/**
 * Codes used by the first release of this app, which numbered the register
 * from a client's list rather than the Controldoc library. Records raised
 * under those codes are read back through this map.
 */
export const LEGACY_CODE_MAP: Record<string, string> = Object.fromEntries(
  Array.from({ length: 42 }, (_, i) => {
    const old = String(i + 1).padStart(3, '0')
    // 001 kept its number; everything after it moved up one to make room for
    // 002 Inground Sewer Rising Main.
    const next = i === 0 ? '001' : String(i + 2).padStart(3, '0')
    return [old, next]
  }),
)
