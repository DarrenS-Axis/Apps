// Engineering libraries for Axis MEP Design.
//
// Every value here is a TYPICAL figure, collected so the tool works out of the
// box. They are not a substitute for the standard you design to: check pipe
// bores against the manufacturer's data and loading / discharge units against
// AS/NZS 3500 (or the code that applies to the job) before issuing a design.
// Each project carries its own copy of the fixture library, so it can be
// edited per job without touching this file.

/** Pipe and duct materials. `id` is the internal bore in mm, roughness in mm. */
export const MATERIALS = {
  copperB: {
    name: 'Copper Type B (AS 1432)',
    kind: 'pipe',
    roughness: 0.0015,
    sizes: [
      { dn: 15, id: 13.84 }, { dn: 20, id: 17.01 }, { dn: 25, id: 22.96 },
      { dn: 32, id: 29.31 }, { dn: 40, id: 35.26 }, { dn: 50, id: 47.54 },
      { dn: 65, id: 60.24 }, { dn: 80, id: 72.14 }, { dn: 100, id: 97.54 },
      { dn: 125, id: 122.0 }, { dn: 150, id: 146.4 },
    ],
  },
  pe100: {
    name: 'PE100 SDR11',
    kind: 'pipe',
    roughness: 0.007,
    sizes: [
      { dn: 20, id: 16.2 }, { dn: 25, id: 20.4 }, { dn: 32, id: 26.2 },
      { dn: 40, id: 32.6 }, { dn: 50, id: 40.8 }, { dn: 63, id: 51.4 },
      { dn: 75, id: 61.4 }, { dn: 90, id: 73.6 }, { dn: 110, id: 90.0 },
      { dn: 125, id: 102.2 }, { dn: 160, id: 130.8 },
    ],
  },
  pvcDwv: {
    name: 'PVC-U DWV (AS/NZS 1260)',
    kind: 'drain',
    // EN 12056-2 designs drainage with kb = 1.0 mm to allow for deposits.
    roughness: 1.0,
    sizes: [
      { dn: 40, id: 37.5 }, { dn: 50, id: 50.4 }, { dn: 65, id: 64.9 },
      { dn: 80, id: 77.8 }, { dn: 100, id: 104.0 }, { dn: 125, id: 119.2 },
      { dn: 150, id: 153.0 }, { dn: 225, id: 238.0 }, { dn: 300, id: 304.0 },
    ],
  },
  galvDuct: {
    name: 'Galvanised steel duct (round)',
    kind: 'duct',
    roughness: 0.09,
    sizes: [100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 800, 900, 1000, 1200]
      .map((d) => ({ dn: d, id: d })),
  },
}

/**
 * Systems. Every link belongs to one system; nodes (fixtures, junctions) are
 * shared, so a basin can be fed by cold and hot water and drain to sewer.
 */
export const SYSTEMS = {
  CW: { name: 'Cold water', kind: 'water', color: '#2f7fd8', material: 'copperB', tempC: 20 },
  HW: { name: 'Heated water', kind: 'water', color: '#d8452f', material: 'copperB', tempC: 60 },
  SAN: { name: 'Sanitary drainage', kind: 'drain', color: '#8a5a2b', material: 'pvcDwv' },
  SA: { name: 'Supply air', kind: 'air', color: '#1f9a7a', material: 'galvDuct' },
}

/**
 * Fixtures. `lu` = loading units, `q` = design flow of one outlet (L/s),
 * `pmin` = minimum working pressure at the outlet (kPa), `hot` = has a hot
 * connection, `du` = discharge unit (L/s, EN 12056-2 System I), `dnMin` =
 * smallest drain it may discharge to.
 */
export const FIXTURES = {
  basin: { name: 'Basin', lu: 1, q: 0.1, pmin: 50, hot: true, du: 0.5, dnMin: 40 },
  shower: { name: 'Shower', lu: 2, q: 0.1, pmin: 50, hot: true, du: 0.6, dnMin: 50 },
  bath: { name: 'Bath', lu: 8, q: 0.3, pmin: 50, hot: true, du: 0.8, dnMin: 40 },
  sink: { name: 'Kitchen sink', lu: 3, q: 0.12, pmin: 50, hot: true, du: 0.8, dnMin: 50 },
  trough: { name: 'Laundry trough', lu: 3, q: 0.12, pmin: 50, hot: true, du: 0.8, dnMin: 50 },
  washer: { name: 'Washing machine', lu: 3, q: 0.2, pmin: 50, hot: false, du: 0.8, dnMin: 50 },
  dishwasher: { name: 'Dishwasher', lu: 3, q: 0.2, pmin: 50, hot: false, du: 0.8, dnMin: 50 },
  wc: { name: 'WC (cistern)', lu: 2, q: 0.1, pmin: 50, hot: false, du: 2.0, dnMin: 100 },
  urinal: { name: 'Urinal', lu: 2, q: 0.1, pmin: 50, hot: false, du: 0.8, dnMin: 50 },
  hosetap: { name: 'Hose tap', lu: 5, q: 0.2, pmin: 50, hot: false, du: 0, dnMin: 40 },
  fw: { name: 'Floor waste', lu: 0, q: 0, pmin: 0, hot: false, du: 0.8, dnMin: 50 },
}

/** Drainage frequency factor K for Qww = K·√ΣDU (EN 12056-2 Table 3). */
export const DRAIN_K = {
  0.5: 'Intermittent use (dwellings, guest houses, offices)',
  0.7: 'Frequent use (hospitals, schools, restaurants, hotels)',
  1.0: 'Congested use (public toilets, showers)',
  1.2: 'Special use (laboratories)',
}

export const DEFAULT_SETTINGS = {
  // m on the drawing per screen pixel at zoom 1
  metresPerPx: 0.05,
  water: {
    method: 'sqrt', // 'sqrt' = probable demand k·√ΣLU, 'sum' = no diversity
    kLU: 0.1, // L/s per √LU
    vMax: 3.0, // m/s — AS/NZS 3500.1 maximum
    fittingsPct: 20,
    pMax: 500, // kPa — flag outlets above this
  },
  drain: { K: 0.5, grade: 1.65, fill: 0.5 },
  air: { friction: 1.0, vMax: 6.0, fittingsPct: 50, terminalPa: 25, rectDepth: 300 },
}
