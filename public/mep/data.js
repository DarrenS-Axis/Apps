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
  NG: { name: 'Natural gas', kind: 'gas', gas: 'NG', color: '#c9a227', material: 'copperB' },
  LPG: { name: 'LPG', kind: 'gas', gas: 'LPG', color: '#e0701b', material: 'copperB' },
}

/**
 * Fuel gases at reference conditions (15 °C, 101.325 kPa). `hv` = gross
 * heating value MJ/m³, `rho` kg/m³, `mu` dynamic viscosity Pa·s. Typical
 * figures — the network operator or supplier publishes the actual values.
 */
export const GASES = {
  NG: { name: 'Natural gas', hv: 38.7, rho: 0.73, mu: 1.1e-5 },
  LPG: { name: 'LPG (propane)', hv: 95.0, rho: 1.87, mu: 8.0e-6 },
}

/** Air density for the stack effect on gas pressure with height. */
export const AIR_RHO = 1.2

/**
 * Fixtures. `lu` = loading units, `q` = design flow of one outlet (L/s),
 * `pmin` = minimum working pressure at the outlet (kPa), `hot` = has a hot
 * connection, `du` = discharge unit (L/s, EN 12056-2 System I), `dnMin` =
 * smallest drain it may discharge to, `mj` = gas consumption (MJ/h).
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
  cooktop: { name: 'Gas cooktop', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 34 },
  oven: { name: 'Gas oven', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 20 },
  hwsInst: { name: 'Gas water heater (continuous flow)', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 199 },
  hwsStor: { name: 'Gas water heater (storage)', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 37 },
  heater: { name: 'Gas space heater', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 25 },
  ducted: { name: 'Ducted gas heater', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 100 },
  bbq: { name: 'BBQ bayonet', lu: 0, q: 0, pmin: 0, hot: false, du: 0, dnMin: 0, mj: 40 },
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
  gas: {
    diversity: 100, // % of connected load, never below the largest appliance
    vMax: 10, // m/s — starting size; pipes are then upsized for pressure
    fittingsPct: 20,
    // Supply pressure is set on each meter / regulator; appliances need at
    // least pMin at their inlet. Typical figures — check AS/NZS 5601.1 and the
    // appliance data plate.
    NG: { supply: 2.75, pMin: 2.5 },
    LPG: { supply: 2.75, pMin: 2.6 },
  },
}
