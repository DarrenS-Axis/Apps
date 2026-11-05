// Project factory and the worked demo, kept free of the DOM so tests can use them.
import { FIXTURES, DEFAULT_SETTINGS } from './data.js'

const clone = (o) => JSON.parse(JSON.stringify(o))

export function newProject(name = 'Untitled project') {
  return { version: 1, name, seq: 0, settings: clone(DEFAULT_SETTINGS), fixtures: clone(FIXTURES), nodes: [], links: [], underlay: null, gasTables: [] }
}

/** A two-bedroom apartment: cold and heated water, drainage, natural gas and supply air. */
export function demoProject() {
  const p = newProject('Demo — 2 bed apartment')
  let seq = 0
  const N = (kind, x, y, extra = {}) => { const n = { id: `N${++seq}`, kind, x, y, z: 0, label: '', ...extra }; p.nodes.push(n); return n.id }
  const L = (a, b, system, extra = {}) => p.links.push({ id: `L${++seq}`, a, b, system, ...extra })

  const meter = N('source', 40, 300, { system: 'CW', pressure: 400, label: 'Water meter' })
  const heater = N('source', 360, 420, { system: 'HW', pressure: 380, label: 'Water heater' })
  const sewer = N('outlet', 40, 600, { system: 'SAN', label: 'Sewer connection', z: -0.6 })
  // fixtures
  const basin = N('fixture', 200, 120, { fixture: 'basin' })
  const shower = N('fixture', 280, 120, { fixture: 'shower' })
  const wc = N('fixture', 360, 120, { fixture: 'wc' })
  const bath = N('fixture', 440, 120, { fixture: 'bath' })
  const fw = N('fixture', 520, 60, { fixture: 'fw', label: 'Bathroom FW' })
  const sink = N('fixture', 580, 300, { fixture: 'sink' })
  const dw = N('fixture', 680, 300, { fixture: 'dishwasher' })
  const trough = N('fixture', 580, 500, { fixture: 'trough' })
  const washer = N('fixture', 680, 500, { fixture: 'washer' })
  const hose = N('fixture', 120, 120, { fixture: 'hosetap', label: 'Garden tap' })
  // cold water
  const c1 = N('junction', 120, 300); const c2 = N('junction', 120, 200)
  const c4 = N('junction', 200, 200); const c5 = N('junction', 280, 200); const c6 = N('junction', 360, 200); const c8 = N('junction', 440, 200)
  const c3 = N('junction', 480, 300); const c7 = N('junction', 480, 500)
  L(meter, c1, 'CW'); L(c1, c2, 'CW'); L(c2, hose, 'CW', { length: 6 }); L(c2, c4, 'CW'); L(c4, basin, 'CW'); L(c4, c5, 'CW')
  L(c5, shower, 'CW'); L(c5, c6, 'CW'); L(c6, wc, 'CW'); L(c6, c8, 'CW'); L(c8, bath, 'CW')
  L(c1, c3, 'CW'); L(c3, sink, 'CW'); L(sink, dw, 'CW'); L(c3, c7, 'CW'); L(c7, trough, 'CW'); L(trough, washer, 'CW')
  // a 3 m cold-water riser from the kitchen tee to a basin on the level above
  const r1 = N('junction', 480, 300, { z: 3 }); const l1 = N('fixture', 480, 160, { fixture: 'basin', label: 'L1 basin', z: 3 })
  L(c3, r1, 'CW'); L(r1, l1, 'CW')
  // heated water
  const h1 = N('junction', 360, 240); const h2 = N('junction', 200, 240); const h3 = N('junction', 280, 240); const h4 = N('junction', 440, 240)
  const h5 = N('junction', 580, 420)
  L(heater, h1, 'HW'); L(h1, h3, 'HW'); L(h3, h2, 'HW'); L(h2, basin, 'HW'); L(h3, shower, 'HW'); L(h1, h4, 'HW'); L(h4, bath, 'HW')
  L(heater, h5, 'HW'); L(h5, sink, 'HW'); L(h5, trough, 'HW')
  // sanitary drainage: a bathroom branch along the top, kitchen and laundry down the right
  const d1 = N('junction', 80, 600, { z: -0.5 }); const dv = N('junction', 80, 60, { z: -0.3 })
  const j1 = N('junction', 200, 60); const j2 = N('junction', 280, 60); const j3 = N('junction', 360, 60); const j4 = N('junction', 440, 60)
  L(sewer, d1, 'SAN'); L(d1, dv, 'SAN'); L(dv, j1, 'SAN'); L(j1, j2, 'SAN'); L(j2, j3, 'SAN'); L(j3, j4, 'SAN'); L(j4, fw, 'SAN')
  L(j1, basin, 'SAN'); L(j2, shower, 'SAN'); L(j3, wc, 'SAN'); L(j4, bath, 'SAN')
  const d3 = N('junction', 760, 600); const k1 = N('junction', 760, 540); const k2 = N('junction', 760, 340)
  const ks = N('junction', 580, 340); const kd = N('junction', 680, 340); const lt = N('junction', 580, 540); const lw = N('junction', 680, 540)
  L(d1, d3, 'SAN'); L(d3, k1, 'SAN'); L(k1, k2, 'SAN'); L(k2, kd, 'SAN'); L(kd, ks, 'SAN'); L(ks, sink, 'SAN'); L(kd, dw, 'SAN')
  L(k1, lw, 'SAN'); L(lw, lt, 'SAN'); L(lt, trough, 'SAN'); L(lw, washer, 'SAN')
  // supply air
  const ahu = N('ahu', 960, 80, { system: 'SA', label: 'FCU-1' })
  const a1 = N('junction', 960, 220); const a2 = N('junction', 960, 400)
  const t1 = N('terminal', 1080, 220, { airflow: 120, label: 'Bed 1' }); const t2 = N('terminal', 860, 220, { airflow: 90, label: 'Bed 2' })
  const t3 = N('terminal', 1080, 400, { airflow: 180, label: 'Living' }); const t4 = N('terminal', 960, 540, { airflow: 110, label: 'Kitchen' })
  L(ahu, a1, 'SA'); L(a1, t1, 'SA'); L(a1, t2, 'SA'); L(a1, a2, 'SA'); L(a2, t3, 'SA'); L(a2, t4, 'SA')
  // natural gas: continuous-flow water heater beside the HW source, cooktop in the kitchen
  const gm = N('source', 40, 700, { system: 'NG', pressure: 2.75, label: 'Gas meter' })
  const hws = N('fixture', 360, 480, { fixture: 'hwsInst', label: 'Gas HWS' })
  const cook = N('fixture', 630, 240, { fixture: 'cooktop' })
  const g1 = N('junction', 360, 700); const g2 = N('junction', 800, 700); const g3 = N('junction', 800, 240)
  L(gm, g1, 'NG'); L(g1, hws, 'NG'); L(g1, g2, 'NG'); L(g2, g3, 'NG'); L(g3, cook, 'NG')
  p.seq = seq
  return p
}

