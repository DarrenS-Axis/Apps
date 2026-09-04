import type { ItpTemplate } from '../types'
import {
  airTest,
  asBuilt,
  backflow,
  bracketing,
  defectsCheck,
  disinfection,
  drawingRevision,
  flushing,
  hydrostaticTest,
  identification,
  insulation,
  mat,
  materialCompliance,
  mk,
  penetrations,
  pressureTest,
  sealOpenEnds,
  valveOperation,
  weldJoints,
} from './common'

const G = 'Above ground' as const

/** Rows shared by every above-ground pipework ITP. */
const aboveGroundCore = (service: string, materialOptions: string, supportStd: string) => [
  drawingRevision(),
  {
    installation: `Set out ${service} against the coordinated services model / shop drawings. Confirm no clash with structure, ductwork, electrical or ceiling zones and that the design falls or grades can be achieved.`,
    acceptance: 'In accordance with the coordinated shop drawings and the hydraulic specification. Clashes resolved and reissued before installation.',
    point: 'X' as const,
    photoHint: 'Set out / coordination marks in the ceiling or riser space',
  },
  materialCompliance(materialOptions),
  bracketing(supportStd),
]

export const aboveGroundTemplates: ItpTemplate[] = [
  /* ------------------------------------------------------------------ 015 */
  mk({
    code: '015',
    title: 'Sanitary Plumbing',
    group: G,
    scope:
      'Above ground sanitary plumbing — stacks, branch drains, fixture discharge pipes, traps and the venting system, from the fixture to the connection with the drain.',
    standards: ['AS/NZS 3500.2:2021', 'AS 4072.1', 'AS 1345'],
    materials: [
      mat('Sanitary pipework', 'PVC-U DWV to AS/NZS 1260, WaterMark certified'),
      mat('Fittings and solvent cement', 'AS/NZS 1260 fittings, priming fluid and cement to AS/NZS 3879'),
      mat('HDPE pipework (where specified)', 'PE to AS/NZS 5065 with electrofusion / butt fusion joints'),
      mat('Brackets and supports', 'Proprietary supports at the centres required by AS/NZS 3500.2 Section 8'),
      mat('Fire collars', 'Tested system to AS 4072.1 matching the FRL of the element penetrated'),
    ],
    items: [
      ...aboveGroundCore('sanitary plumbing', 'PVC-U DWV / HDPE — check for damage and correct SN/class', "AS/NZS 3500.2:2021 Section 8 'Fixing and Support'"),
      {
        installation: 'Check pipe sizes, grades and fall of all branch and stack pipework against the approved drawings.',
        acceptance:
          "In accordance with AS/NZS 3500.2:2021 Section 6 'Sanitary Plumbing' and Section 3.4 for grades. Minimum falls achieved throughout.",
        point: 'X',
        recordLabel: 'Grade achieved',
        recordUnit: '%',
        photoHint: 'Level reading on a typical branch',
      },
      {
        installation: 'Check trap types, seal depths and trap ventilation for each fixture group.',
        acceptance:
          "Trap seal depth and venting in accordance with AS/NZS 3500.2:2021 Section 6 'Venting' and Section 10. No unvented arrangement outside the permitted limits.",
        point: 'X',
        recordLabel: 'Trap seal depth',
        recordUnit: 'mm',
        photoHint: 'Typical trap arrangement with vent',
      },
      {
        installation: 'Check stack offsets, expansion joints, and provision for building and thermal movement.',
        acceptance: "In accordance with AS/NZS 3500.2:2021 and the pipe manufacturer's requirements. Anchors and guides installed as detailed.",
        point: 'X',
        photoHint: 'Expansion joint and anchor detail',
      },
      {
        installation: 'Check inspection openings and access points to stacks and branches are provided and accessible after fit-out.',
        acceptance: 'In accordance with AS/NZS 3500.2:2021 and the approved drawings. Access panels coordinated with the architect.',
        point: 'X',
        photoHint: 'Inspection opening with access panel',
      },
      penetrations(),
      {
        installation: 'Check acoustic lagging to stacks and branches within noise-sensitive areas.',
        acceptance: 'In accordance with the acoustic report and the hydraulic specification. Lagging continuous, including at brackets and penetrations.',
        point: 'X',
        photoHint: 'Lagged stack including bracket detail',
      },
      hydrostaticTest({ minutes: 15 }),
      airTest(30, 15),
      identification('sanitary plumbing', 'Black / "SANITARY"'),
      sealOpenEnds(),
      flushing(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 016 */
  mk({
    code: '016',
    title: 'Sewer Rising Main',
    group: G,
    scope:
      'Above ground pumped sewage rising main from the pump station discharge flange to the gravity discharge point, including valves, air release and supports.',
    standards: ['AS/NZS 3500.2:2021', 'AS/NZS 4130', 'AS 1345'],
    materials: [
      mat('Rising main pipework', 'PE100 to AS/NZS 4130 or copper / stainless to the specified pressure class'),
      mat('Fittings and jointing', 'Electrofusion / flanged fittings rated to the pump shut-off head'),
      mat('Valves', 'Non-return and isolation valves, sewage duty, accessible for maintenance'),
      mat('Supports', 'Supports designed for the full water-filled weight plus surge'),
      mat('Air release', 'Sewage duty air release valve at high points, discharging to a safe location'),
    ],
    items: [
      ...aboveGroundCore('sewer rising main', 'PE100 / copper / stainless — PN class to exceed pump shut-off head', 'the hydraulic specification and the pipe manufacturer’s support tables'),
      weldJoints('electrofusion / butt fusion / flanged'),
      {
        installation: 'Check the rising main route, high points and air release valve locations, and the discharge arrangement into the gravity system.',
        acceptance:
          "In accordance with AS/NZS 3500.2:2021 Section 12 'Pumped Systems' and the approved drawings. Discharge arranged to avoid surcharge and septicity.",
        point: 'X',
        photoHint: 'High point air release and discharge point',
      },
      {
        installation: 'Check non-return and isolation valves, including access, orientation, and provision for pump removal.',
        acceptance: 'In accordance with the approved drawings. Valves accessible, labelled and correctly oriented.',
        point: 'X',
        photoHint: 'Valve arrangement at the pump discharge',
      },
      {
        installation: 'Check pipe supports, restraint and anchoring for surge and water hammer loads.',
        acceptance: "In accordance with the hydraulic specification and the pipe manufacturer's support spacing. Anchors at all changes of direction.",
        point: 'X',
        photoHint: 'Support and anchor at a change of direction',
      },
      penetrations(),
      pressureTest(1000, 60, "AS/NZS 3500.2:2021 Section 15 'Testing' and the pump shut-off head"),
      {
        installation: 'Operate the pump set and confirm the rising main performs without leakage, excessive movement or water hammer.',
        acceptance: 'No leakage, no excessive movement and no audible hammer under start / stop cycling. Duty and standby pumps both proven.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Rising main under running conditions',
      },
      identification('sewer rising main', 'Black with "SEWER RISING MAIN" and directional arrows'),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 017 */
  mk({
    code: '017',
    title: 'Tradewaste Drainage',
    group: G,
    scope:
      'Above ground trade waste drainage from plant, kitchen and process equipment to the pre-treatment device, including tundishes, air breaks and venting.',
    standards: ['AS/NZS 3500.2:2021', 'Water authority trade waste agreement', 'AS 1345'],
    materials: [
      mat('Trade waste pipework', 'HDPE PE to AS/NZS 5065 or chemical resistant pipework as specified'),
      mat('Jointing', 'Electrofusion / butt fusion by a qualified operator'),
      mat('Tundishes and air breaks', 'Type and size to the trade waste agreement and AS/NZS 3500.2'),
      mat('Supports', 'Supports and anchors allowing for thermal movement of HDPE'),
    ],
    items: [
      ...aboveGroundCore('trade waste drainage', 'HDPE / chemical resistant pipework — confirm chemical compatibility with the discharge', "AS/NZS 3500.2:2021 Section 8 'Fixing and Support'"),
      weldJoints('electrofusion / butt fusion'),
      {
        installation: 'Check air breaks / tundishes at all equipment connections and confirm no direct connection where an air break is required.',
        acceptance: 'In accordance with AS/NZS 3500.2:2021 and the water authority trade waste agreement.',
        point: 'X',
        photoHint: 'Air break at an equipment connection',
      },
      {
        installation: 'Check pipe grades, falls and venting of the trade waste system.',
        acceptance: 'In accordance with AS/NZS 3500.2:2021 Section 3.4 for grades and Section 6 for venting.',
        point: 'X',
        recordLabel: 'Grade achieved',
        recordUnit: '%',
        photoHint: 'Level reading on a branch',
      },
      {
        installation: 'Check provision for thermal expansion of HDPE pipework, including anchors, guides and expansion sockets.',
        acceptance: "In accordance with the pipe manufacturer's design guidance and the hydraulic specification.",
        point: 'X',
        photoHint: 'Expansion socket and anchor arrangement',
      },
      penetrations(),
      hydrostaticTest({ minutes: 15 }),
      airTest(30, 15),
      identification('trade waste drainage', 'As required by AS 1345 with "TRADE WASTE"'),
      sealOpenEnds(),
      flushing(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 018 */
  mk({
    code: '018',
    title: 'Stormwater Drainage',
    group: G,
    scope:
      'Above ground stormwater drainage — gutters, sumps, rainheads, downpipes, overflow provisions and box gutters, to the connection with the inground system.',
    standards: ['AS/NZS 3500.3:2021', 'AS 1345', 'AS 4072.1'],
    materials: [
      mat('Downpipe and stormwater pipework', 'PVC-U to AS/NZS 1254 / AS/NZS 1260 or metal as specified'),
      mat('Gutters and rainheads', 'Profile, material and finish to the architectural drawings'),
      mat('Overflow devices', 'Sized to the certified roof drainage calculation'),
      mat('Brackets and supports', 'Supports at the centres required by AS/NZS 3500.3 and the specification'),
    ],
    items: [
      ...aboveGroundCore('stormwater drainage', 'PVC-U / metal downpipes and gutters — check for damage and finish', "AS/NZS 3500.3:2021 Section 8 'Fixing and Support'"),
      {
        installation: 'Check gutter and box gutter sizes, falls, sump positions and freeboard against the certified roof drainage calculation.',
        acceptance:
          'In accordance with AS/NZS 3500.3:2021 and the certified roof drainage design for the nominated ARI. Falls and freeboard to the design.',
        point: 'H',
        releasedBy: 'Hydraulic consultant',
        recordLabel: 'Box gutter fall',
        recordUnit: '%',
        photoHint: 'Box gutter with sump and measured freeboard',
      },
      {
        installation: 'Check overflow provisions — rainhead weirs, overflow outlets and emergency spillways — for size and level.',
        acceptance: 'In accordance with AS/NZS 3500.3:2021 overflow requirements and the certified design. Overflow discharges clear of the building.',
        point: 'X',
        photoHint: 'Overflow outlet with levels',
      },
      {
        installation: 'Check downpipe sizes, positions, offsets and connection to the inground system.',
        acceptance: 'In accordance with the approved hydraulic and architectural drawings.',
        point: 'X',
        photoHint: 'Downpipe run and connection',
      },
      penetrations(),
      {
        installation: 'Water test gutters, sumps and downpipes for leakage and correct fall.',
        acceptance: "No leakage and no ponding outside the permitted tolerance, in accordance with AS/NZS 3500.3:2021 Section 15 'Testing'.",
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Gutter under water test',
      },
      flushing(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 019 */
  mk({
    code: '019',
    title: 'Stormwater Rising Main',
    group: G,
    scope:
      'Above ground pumped stormwater discharge main from the pump station to the gravity discharge or detention point, including valves and supports.',
    standards: ['AS/NZS 3500.3:2021', 'AS/NZS 4130', 'AS 1345'],
    materials: [
      mat('Rising main pipework', 'PE100 to AS/NZS 4130 or galvanised / stainless steel, class to exceed pump shut-off head'),
      mat('Fittings and jointing', 'Electrofusion / flanged / grooved fittings to the specified pressure class'),
      mat('Valves', 'Non-return and isolation valves, accessible for maintenance'),
      mat('Supports and anchors', 'Designed for water-filled weight, thermal movement and surge'),
    ],
    items: [
      ...aboveGroundCore('stormwater rising main', 'PE100 / steel — PN class to exceed pump shut-off head', 'the hydraulic specification and the pipe manufacturer’s support tables'),
      weldJoints('electrofusion / butt fusion / flanged / grooved'),
      {
        installation: 'Check valve arrangement at the pump discharge — non-return, isolation and provision for pump removal.',
        acceptance: 'In accordance with the approved drawings. Valves accessible, labelled and correctly oriented.',
        point: 'X',
        photoHint: 'Discharge valve arrangement',
      },
      {
        installation: 'Check supports, anchors and restraint for surge and water hammer.',
        acceptance: 'In accordance with the hydraulic specification. Anchors at all changes of direction, guides at the specified centres.',
        point: 'X',
        photoHint: 'Anchor at a change of direction',
      },
      penetrations(),
      pressureTest(1000, 60, "AS/NZS 3500.3:2021 Section 15 'Testing' and the pump shut-off head"),
      {
        installation: 'Operate the pump set and confirm the rising main performs without leakage, movement or water hammer.',
        acceptance: 'No leakage or audible hammer under start / stop cycling. Duty and standby pumps both proven.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Rising main under running conditions',
      },
      identification('stormwater rising main', 'As required by AS 1345 with directional arrows'),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 020 */
  mk({
    code: '020',
    title: 'Siphonic Drainage',
    group: G,
    scope:
      'Above ground siphonic roof drainage — outlets, tail pipes, collector pipework, bracketry and the transition to the gravity system.',
    standards: ['AS/NZS 3500.3:2021', "Siphonic system designer's certified design", 'AS/NZS 5065'],
    materials: [
      mat('Siphonic pipework', 'HDPE to AS/NZS 5065 / AS/NZS 4130 to the certified siphonic design, full vacuum rated'),
      mat('Siphonic outlets', 'Proprietary outlets matched to the certified design, with baffle plates'),
      mat('Jointing', 'Electrofusion / butt fusion by a qualified operator'),
      mat('Bracketry', 'Proprietary siphonic rail and bracket system to the designer’s details'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Confirm the certified siphonic design and calculations issued for construction match the drawings on site.',
        acceptance: 'Certified design current. No substitution of outlet type, pipe diameter or route without re-certification.',
        point: 'H',
        releasedBy: 'Siphonic system designer',
        recordLabel: 'Certified design reference',
        photoHint: 'Certified design cover sheet',
      },
      materialCompliance('HDPE to the certified siphonic design — no substitution permitted'),
      {
        installation: 'Check siphonic outlet type, position, baffle plate and the flashing / waterproofing interface at each outlet.',
        acceptance: 'In accordance with the certified design and the roofing / waterproofing details. Outlets set to the gutter sole level.',
        point: 'X',
        photoHint: 'Installed outlet with flashing detail',
      },
      weldJoints('electrofusion / butt fusion'),
      {
        installation: 'Check every pipe diameter, length and fitting against the certified calculation set, including reducers and tail pipes.',
        acceptance:
          'Full compliance with the certified siphonic calculation. Any deviation recorded and re-certified before the system is closed in.',
        point: 'H',
        releasedBy: 'Siphonic system designer',
        photoHint: 'Installed run with diameter markings',
      },
      {
        installation: 'Check the proprietary bracketry and rail system, fixing centres and restraint against the full vacuum and thermal loads.',
        acceptance: "In accordance with the siphonic designer's bracketry details and the manufacturer's requirements. No standard plumbing clips substituted.",
        point: 'X',
        photoHint: 'Rail and bracket arrangement',
      },
      penetrations(),
      {
        installation: 'Check the break pressure / transition to the gravity stormwater system, including venting.',
        acceptance: 'In accordance with the certified design and AS/NZS 3500.3:2021.',
        point: 'X',
        photoHint: 'Transition arrangement',
      },
      hydrostaticTest({ minutes: 15, std: "AS/NZS 3500.3:2021 Section 15 'Testing'" }),
      {
        installation: 'Simulated flow / wet test of the completed siphonic system to prove priming and full bore operation.',
        acceptance: 'System primes and runs full bore within the time stated in the certified design, with no leakage, movement or excessive noise.',
        point: 'H',
        releasedBy: 'Siphonic system designer / Superintendent',
        photoHint: 'Flow test at outlets and at the discharge',
      },
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 021 */
  mk({
    code: '021',
    title: 'Fuel and Stormwater Drainage',
    group: G,
    scope:
      'Above ground drainage from fuel handling and plant areas — bunded areas, sumps, tundishes and pipework to the fuel / oil water separator.',
    standards: ['AS 1940', 'AS/NZS 3500.3:2021', 'Water authority trade waste agreement', 'EPA requirements'],
    materials: [
      mat('Drainage pipework', 'Fuel resistant pipework and seals as specified'),
      mat('Bund drainage', 'Valved bund drain arrangement, normally closed, with spill containment'),
      mat('Sumps and tundishes', 'Fuel resistant, sealed and accessible'),
      mat('Supports', 'Corrosion protected supports suitable for the environment'),
    ],
    items: [
      ...aboveGroundCore('fuel and stormwater drainage', 'Fuel resistant pipework and elastomeric seals — confirm chemical compatibility', 'the hydraulic specification'),
      {
        installation: 'Check bunded area falls, sump positions and containment volume; confirm the bund drain valve is normally closed and lockable.',
        acceptance:
          "In accordance with AS 1940 'The Storage and Handling of Flammable and Combustible Liquids' and the approved drawings. Containment volume confirmed by calculation.",
        point: 'H',
        releasedBy: 'EPA / Superintendent',
        recordLabel: 'Containment volume',
        recordUnit: 'L',
        photoHint: 'Bund with drain valve and falls',
      },
      {
        installation: 'Confirm no clean stormwater catchment is connected to the fuel drainage system.',
        acceptance: 'In accordance with the approved drawings and the trade waste agreement. Catchments verified on site.',
        point: 'X',
        photoHint: 'Catchment boundary and diversion',
      },
      {
        installation: 'Check connections to the fuel / oil water separator, including inlet arrangement and sampling point access.',
        acceptance: 'In accordance with the trade waste agreement and the separator manufacturer’s requirements.',
        point: 'X',
        photoHint: 'Separator inlet and sampling point',
      },
      penetrations(),
      hydrostaticTest({ minutes: 15, std: "AS/NZS 3500.3:2021 Section 15 'Testing'" }),
      identification('fuel drainage', 'As required by AS 1345 with hazard identification to AS 1319'),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 022 */
  mk({
    code: '022',
    title: 'Potable Cold Water',
    group: G,
    scope:
      'Above ground potable cold water reticulation from the building entry to the fixture isolation valves, including risers, valves, meters and backflow protection.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 4020', 'AS 2845.1', 'AS 1345', 'NCC Section J'],
    materials: [
      mat('Cold water pipework', 'Copper Type B to AS 1432, or PEX / PP-R / stainless as specified, WaterMark certified'),
      mat('Fittings', 'Press / capillary / crimp fittings to AS 3688 or the system manufacturer, WaterMark certified'),
      mat('Drinking water suitability', 'All wetted products certified to AS/NZS 4020'),
      mat('Valves', 'Isolation and non-return valves to the specified class, with union connections'),
      mat('Insulation', 'Thickness and vapour barrier to NCC Section J and the specification'),
    ],
    items: [
      ...aboveGroundCore('potable cold water', 'Copper Type B / PEX / PP-R / stainless — WaterMark and AS/NZS 4020 certified', "AS/NZS 3500.1:2021 Section 5 'Water Service Installation'"),
      {
        installation: 'Check pipe sizes against the approved hydraulic drawings and the sizing calculation, including riser and branch sizes.',
        acceptance: "In accordance with AS/NZS 3500.1:2021 Section 3 'Design' and the approved drawings.",
        point: 'X',
        photoHint: 'Riser with sizes marked',
      },
      {
        installation: 'Check jointing method, tool calibration and jaw condition for pressed / crimped systems.',
        acceptance: "In accordance with the system manufacturer's instructions. Tool service records current, correct jaws used for each size.",
        point: 'S',
        releasedBy: 'Superintendent',
        photoHint: 'Tool calibration label and a completed joint',
      },
      {
        installation: 'Check isolation valve locations, meters, strainers and non-return valves; confirm access for maintenance.',
        acceptance: 'In accordance with the approved drawings. Valves accessible, labelled and shown on the valve chart.',
        point: 'X',
        photoHint: 'Valve set with labels',
      },
      backflow(),
      {
        installation: 'Check dissimilar metal separation and provision for thermal movement in long runs and risers.',
        acceptance: "In accordance with AS/NZS 3500.1:2021 and the manufacturer's requirements. Dielectric separation where required.",
        point: 'X',
        photoHint: 'Expansion loop / dielectric fitting',
      },
      penetrations(),
      insulation(),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      flushing(),
      disinfection(),
      identification('potable cold water', 'Blue / "POTABLE WATER" to AS 1345 and AS 2700'),
      valveOperation(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 023 */
  mk({
    code: '023',
    title: 'Non Potable Water',
    group: G,
    scope:
      'Above ground non-potable (recycled, rainwater or bore) water reticulation, including identification, outlet control and cross-connection verification.',
    standards: ['AS/NZS 3500.1:2021', 'AS 2845.1', 'AS 1345', 'AS 2700'],
    materials: [
      mat('Non-potable pipework', 'Lilac (Wisteria) identified pipework or pipework fully wrapped in lilac identification'),
      mat('Fittings', 'WaterMark certified fittings to suit the pipe system'),
      mat('Identification', 'Lilac identification and "NON-POTABLE WATER — DO NOT DRINK" signage at all outlets'),
      mat('Outlets', 'Lockable / removable-key outlets to prevent unauthorised use'),
    ],
    items: [
      ...aboveGroundCore('non-potable water', 'Lilac identified pipework — confirm no potable-marked pipe substituted', "AS/NZS 3500.1:2021 Section 5 'Water Service Installation'"),
      {
        installation:
          'Carry out and document a full cross-connection check between the potable and non-potable systems, including a dye / pressure differential test where specified.',
        acceptance:
          "No cross-connection found. In accordance with AS/NZS 3500.1:2021 Section 4 'Cross-connection Control' and the water authority requirements. Test certificate provided.",
        point: 'H',
        releasedBy: 'Water authority / Superintendent',
        recordLabel: 'Cross-connection test ref.',
        photoHint: 'Cross-connection test and certificate',
      },
      {
        installation: 'Check all outlets are of the controlled type (lockable / removable key) and signed as non-potable.',
        acceptance: 'In accordance with AS/NZS 3500.1:2021 and the water authority requirements. Signage at every outlet.',
        point: 'X',
        photoHint: 'Controlled outlet with signage',
      },
      backflow(),
      penetrations(),
      insulation(),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      flushing(),
      identification(
        'non-potable water',
        'Lilac (Wisteria) with "NON-POTABLE WATER — DO NOT DRINK" at the intervals required by AS 1345',
      ),
      valveOperation(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 024 */
  mk({
    code: '024',
    title: 'Hot Water Service',
    group: G,
    scope:
      'Above ground heated water reticulation — flow, return, tempering and thermostatic mixing valves, expansion control and delivery temperature verification.',
    standards: ['AS/NZS 3500.4:2021', 'AS/NZS 3500.1:2021', 'AS/NZS 3666.1', 'NCC Section J'],
    materials: [
      mat('Hot water pipework', 'Copper Type B to AS 1432 or PEX / PP-R rated for the design temperature and pressure'),
      mat('Fittings', 'Rated for continuous hot water service, WaterMark certified'),
      mat('Tempering / TMV', 'Valves to AS 4032.2 / AS 4032.3, WaterMark certified'),
      mat('Insulation', 'Thickness to NCC Section J with continuous vapour and weather protection'),
      mat('Expansion control', 'Expansion control valve and relief line to a safe, visible discharge'),
    ],
    items: [
      ...aboveGroundCore('heated water service', 'Copper Type B / PEX / PP-R rated for the design temperature', "AS/NZS 3500.4:2021 Section 6 'Installation'"),
      {
        installation: 'Check flow and return pipe sizes, circulation arrangement, balancing valves and dead leg lengths.',
        acceptance:
          "In accordance with AS/NZS 3500.4:2021 and the approved drawings. Dead legs within the maximum permitted length so delivery time is met.",
        point: 'X',
        recordLabel: 'Longest dead leg',
        recordUnit: 'm',
        photoHint: 'Circulation loop and balancing valve',
      },
      {
        installation: 'Check provision for thermal expansion — expansion loops, offsets, anchors and guides.',
        acceptance: "In accordance with the pipe manufacturer's expansion data and the hydraulic specification.",
        point: 'X',
        photoHint: 'Expansion loop with anchor and guides',
      },
      {
        installation: 'Check tempering valve / TMV installation, orientation, isolation, strainers and access for servicing.',
        acceptance: "In accordance with AS/NZS 3500.4:2021 Section 1.9 and the manufacturer's instructions. Serviceable access provided.",
        point: 'X',
        photoHint: 'TMV set with isolation and strainers',
      },
      {
        installation: 'Check expansion control valve, relief line and discharge point termination.',
        acceptance: 'In accordance with AS/NZS 3500.4:2021. Relief discharge visible, unrestricted and to a safe location.',
        point: 'X',
        photoHint: 'Relief discharge termination',
      },
      penetrations(),
      insulation(),
      pressureTest(1500, 30, "AS/NZS 3500.4:2021 and AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      flushing(),
      {
        installation:
          'Commission the heated water service and record delivery temperatures at the most remote and most disadvantaged outlets.',
        acceptance:
          'Delivery temperature not exceeding 45 °C at ablution fixtures in the applicable classes (50 °C elsewhere) in accordance with AS/NZS 3500.4:2021, and stored / circulated temperature to AS/NZS 3666.1 for Legionella control.',
        point: 'H',
        releasedBy: 'Superintendent / Building certifier',
        recordLabel: 'Delivery temperature',
        recordUnit: '°C',
        photoHint: 'Calibrated thermometer at the outlet',
      },
      identification('heated water service', 'Red-brown / "HOT WATER" with flow and return marked'),
      valveOperation(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 025 */
  mk({
    code: '025',
    title: 'Natural Gas',
    group: G,
    scope:
      'Above ground natural gas consumer piping from the meter / regulator to appliance isolation valves, including ventilation, sleeving and purging.',
    standards: ['AS/NZS 5601.1:2022', 'AS 1345', 'AS 4072.1'],
    materials: [
      mat('Gas pipework', 'Copper to AS 1432 Type B, or steel to AS 1074 / AS 4041 as specified'),
      mat('Fittings', 'Brazed / threaded / pressed gas rated fittings certified for gas service'),
      mat('Valves', 'Gas isolation valves, appliance isolation at each appliance'),
      mat('Sleeving and sealing', 'Gas rated sleeves through building elements, vented where required'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Confirm licensed gas fitter and that works are notified to the gas distributor / Technical Regulator.',
        acceptance: 'Licensed gas fitter engaged, works notified in accordance with AS/NZS 5601.1:2022.',
        point: 'H',
        releasedBy: 'Office of the Technical Regulator / Gas distributor',
        recordLabel: 'Notification / job no.',
      },
      materialCompliance('Copper Type B / steel — confirm certified for gas service'),
      bracketing('AS/NZS 5601.1:2022 Section 5 and the hydraulic specification'),
      {
        installation: 'Check pipe sizing against the appliance load and the sizing calculation, including allowance for future load.',
        acceptance: "In accordance with AS/NZS 5601.1:2022 Section 3 'Pipe Sizing' and the approved drawings.",
        point: 'X',
        recordLabel: 'Total connected load',
        recordUnit: 'MJ/h',
        photoHint: 'Meter / regulator set and pipe sizes',
      },
      {
        installation: 'Check routing restrictions — no gas piping in unventilated voids, ceiling spaces or lift shafts where prohibited; sleeved where passing through building elements.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 5. Sleeves vented to atmosphere where required.',
        point: 'X',
        photoHint: 'Sleeved penetration and vent',
      },
      {
        installation: 'Check appliance isolation valves, unions, regulators and connections at each appliance.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 and the appliance manufacturer’s installation instructions. Isolation accessible at each appliance.',
        point: 'X',
        photoHint: 'Appliance isolation and connection',
      },
      {
        installation: 'Check ventilation to appliance and plant rooms, including free ventilation areas.',
        acceptance: "In accordance with AS/NZS 5601.1:2022 Section 6 'Ventilation Requirements' for the connected appliance load.",
        point: 'X',
        recordLabel: 'Free ventilation area',
        recordUnit: 'mm²',
        photoHint: 'Ventilation openings to the plant room',
      },
      penetrations(),
      {
        installation: 'Pressure / leakage test the consumer piping.',
        acceptance: "Test pressure and duration in accordance with AS/NZS 5601.1:2022 Section 5.3 'Testing for Leakage' with no measurable pressure drop.",
        point: 'H',
        releasedBy: 'Office of the Technical Regulator / Gas distributor',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Gauge at start and end of test',
      },
      {
        installation: 'Purge, commission and check operation of all appliances. Issue the gas compliance certificate.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 6. Compliance certificate issued and provided to the client.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Compliance certificate and appliance operating',
      },
      identification('gas service', 'Yellow ochre / "NATURAL GAS" to AS 1345'),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 026 */
  mk({
    code: '026',
    title: 'LPG Gas',
    group: G,
    scope:
      'Above ground LP Gas consumer piping from the vessel / cylinder bank and regulators to appliance isolation valves, including ventilation and low level leak considerations.',
    standards: ['AS/NZS 5601.1:2022', 'AS/NZS 1596:2014', 'AS 1345'],
    materials: [
      mat('Gas pipework', 'Copper to AS 1432 Type B or steel as specified, certified for LP Gas service'),
      mat('Fittings', 'Brazed / threaded fittings rated for LP Gas'),
      mat('Regulators', 'First and second stage regulators with relief vents terminated safely'),
      mat('Cylinders / vessel', 'Restraint, hardstand and separation to AS/NZS 1596'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Confirm licensed gas fitter and notification to the Technical Regulator.',
        acceptance: 'Licensed gas fitter engaged, works notified in accordance with AS/NZS 5601.1:2022.',
        point: 'H',
        releasedBy: 'Office of the Technical Regulator',
        recordLabel: 'Notification / job no.',
      },
      {
        installation: 'Check cylinder / vessel location, restraint, hardstand and separation distances to boundaries, openings, drains, pits and ignition sources.',
        acceptance: 'In accordance with AS/NZS 1596:2014 separation requirements and the approved site plan. LP Gas is heavier than air — no accumulation points below the vessel.',
        point: 'H',
        releasedBy: 'Office of the Technical Regulator',
        recordLabel: 'Min. separation achieved',
        recordUnit: 'm',
        photoHint: 'Vessel with measured separation distances',
      },
      materialCompliance('Copper Type B / steel certified for LP Gas service'),
      bracketing('AS/NZS 5601.1:2022 Section 5 and the hydraulic specification'),
      {
        installation: 'Check regulator set, relief vent terminations, overpressure protection and pipe sizing for the connected load.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 3 and AS/NZS 1596:2014. Vents terminate in a safe, ventilated location clear of openings.',
        point: 'X',
        recordLabel: 'Total connected load',
        recordUnit: 'MJ/h',
        photoHint: 'Regulator set and vent terminations',
      },
      {
        installation: 'Check ventilation to appliance / plant rooms, with particular attention to low level ventilation for LP Gas.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 6 ventilation requirements, including low level ventilation.',
        point: 'X',
        recordLabel: 'Free ventilation area',
        recordUnit: 'mm²',
        photoHint: 'High and low level ventilation openings',
      },
      penetrations(),
      {
        installation: 'Pressure / leakage test the consumer piping.',
        acceptance: "Test pressure and duration in accordance with AS/NZS 5601.1:2022 Section 5.3 'Testing for Leakage' with no measurable pressure drop.",
        point: 'H',
        releasedBy: 'Office of the Technical Regulator',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Gauge at start and end of test',
      },
      {
        installation: 'Purge, commission and check operation of all appliances. Install required signage and fire extinguisher. Issue the gas compliance certificate.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 6 and AS/NZS 1596:2014 signage requirements.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Signage, extinguisher and compliance certificate',
      },
      identification('LP Gas service', 'Yellow ochre / "LP GAS" to AS 1345'),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 027 */
  mk({
    code: '027',
    title: 'Hot and Cold Water Roughins',
    group: G,
    scope:
      'Hot and cold water rough-in to fixtures prior to wall and floor linings — set out dimensions, fixing, pressure testing and protection.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 3500.4:2021', 'AS 1428.1'],
    materials: [
      mat('Rough-in pipework', 'Copper Type B to AS 1432 or PEX to AS 2492 / AS 5200 series, WaterMark certified'),
      mat('Fixing plates and brackets', 'Proprietary rough-in plates and noggins to suit the fixture'),
      mat('Isolation', 'Fixture isolation stops where required by the specification'),
      mat('Protection', 'Capped and protected ends, nail plates at studs where required'),
    ],
    items: [
      drawingRevision(),
      {
        installation:
          'Set out rough-in points from the architectural fixture layout and the manufacturer’s rough-in template. Confirm tile module, finished floor level and finished wall face.',
        acceptance:
          "In accordance with the architectural drawings, the fixture manufacturer's rough-in dimensions and AS 1428.1 where accessible fixtures apply.",
        point: 'H',
        releasedBy: 'Superintendent / Architect',
        photoHint: 'Rough-in set out with dimensions marked on the wall',
      },
      materialCompliance('Copper Type B / PEX — WaterMark certified, correct hot and cold identification'),
      {
        installation: 'Check rough-in heights and centres for each fixture type against the schedule, including accessible fixtures.',
        acceptance:
          'Within the tolerance stated in the hydraulic specification. Accessible fixtures set out in accordance with AS 1428.1.',
        point: 'X',
        recordLabel: 'Max deviation',
        recordUnit: 'mm',
        photoHint: 'Tape measure showing rough-in height',
      },
      {
        installation: 'Check hot and cold orientation at every rough-in (hot to the left facing the fixture unless otherwise specified).',
        acceptance: 'In accordance with AS/NZS 3500.1:2021 and the hydraulic specification. Hot and cold clearly identified.',
        point: 'X',
        photoHint: 'Rough-in showing hot / cold identification',
      },
      bracketing("AS/NZS 3500.1:2021 Section 5 'Water Service Installation'"),
      {
        installation: 'Check protection to pipework within wall and floor build-ups — nail plates, sleeving through studs and protection from mechanical damage.',
        acceptance: 'In accordance with AS/NZS 3500.1:2021 and the specification. Nail plates at all studs and noggins where required.',
        point: 'X',
        photoHint: 'Nail plates and sleeving at studs',
      },
      insulation(),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      {
        installation: 'Hold the rough-in under test pressure while linings are installed, and confirm the gauge before and after lining.',
        acceptance: 'Pressure maintained through the lining works. Any loss investigated and rectified before the wall is closed.',
        point: 'W',
        releasedBy: 'Superintendent / Head contractor',
        recordLabel: 'Pressure at lining completion',
        recordUnit: 'kPa',
        photoHint: 'Gauge on the wall during lining works',
      },
      {
        installation: 'Cap and protect all rough-in points; photograph the completed rough-in with dimensions before the wall is lined.',
        acceptance: 'All ends capped. A dimensioned photographic record taken of every wall before lining, filed against this ITP.',
        point: 'X',
        photoHint: 'Full wall elevation with tape / dimensions visible',
      },
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 028 */
  mk({
    code: '028',
    title: 'Fire Hydrant Service',
    group: G,
    scope:
      'Above ground fire hydrant installation — risers, landing valves, boosters, block plans and flow and pressure commissioning.',
    standards: ['AS 2419.1:2021', 'AS 1851:2012', 'AS 1345'],
    materials: [
      mat('Hydrant pipework', 'Galvanised steel to AS 1074 / AS 4041 or as specified, rated to the system pressure'),
      mat('Fittings and jointing', 'Threaded / grooved / flanged fittings rated to the system pressure'),
      mat('Landing valves', 'Hydrant landing valves to AS 2419.2 with the specified outlet and coupling'),
      mat('Booster assembly', 'Booster to AS 2419.1 with the required signage and block plan'),
      mat('Supports', 'Supports and seismic restraint to the specification'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Set out hydrant risers and landing valve locations, confirming coverage of the hydraulically most disadvantaged areas.',
        acceptance: "In accordance with AS 2419.1:2021 Section 3 'Location' and the fire engineering report.",
        point: 'H',
        releasedBy: 'Fire engineer / Building surveyor',
        photoHint: 'Landing valve position with coverage dimensions',
      },
      materialCompliance('Galvanised steel / as specified — confirm pressure rating and certification'),
      bracketing('AS 2419.1:2021 and the hydraulic specification'),
      {
        installation: 'Check landing valve height, orientation, outlet type and clearances at each hydrant.',
        acceptance: 'In accordance with AS 2419.1:2021 Section 3. Landing valve within the permitted height range and unobstructed.',
        point: 'X',
        recordLabel: 'Landing valve height',
        recordUnit: 'mm',
        photoHint: 'Landing valve with measured height',
      },
      {
        installation: 'Check booster assembly location, access, signage, block plan and protection from vehicle impact.',
        acceptance: 'In accordance with AS 2419.1:2021 Section 5 and the fire engineering report. Block plan current and legible.',
        point: 'H',
        releasedBy: 'Fire engineer / Building surveyor',
        photoHint: 'Booster with signage and block plan',
      },
      penetrations(),
      {
        installation: 'Hydrostatically test the hydrant installation.',
        acceptance:
          "Test pressure of 1700 kPa, or 500 kPa above the maximum system pressure where that is greater, held for the period required by AS 2419.1:2021 Section 9, with no loss.",
        point: 'H',
        releasedBy: 'Fire services certifier',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Gauge at start and end of the test',
      },
      flushing(),
      {
        installation:
          'Commission the hydrant system — flow and pressure test at the hydraulically most disadvantaged hydrant, with and without the booster where applicable.',
        acceptance:
          'Flow and residual pressure to meet AS 2419.1:2021 Section 2 and the fire engineering report. Commissioning results recorded on the AS 1851 baseline data sheet.',
        point: 'H',
        releasedBy: 'Fire engineer / Certifier',
        recordLabel: 'Flow / residual pressure',
        recordUnit: 'L/s @ kPa',
        photoHint: 'Flow test with pitot and pressure gauge readings',
      },
      identification('fire hydrant service', 'Signal red to AS 2700 with "FIRE HYDRANT" identification'),
      valveOperation(),
      defectsCheck(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 029 */
  mk({
    code: '029',
    title: 'Sanitary Fixtures and Tapware',
    group: G,
    scope:
      'Installation of sanitary fixtures, tapware, accessories and their connections — set out, sealing, operation, temperature and accessibility compliance.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 3500.2:2021', 'AS 1428.1', 'WELS'],
    materials: [
      mat('Sanitary fixtures', 'Type, model and finish to the fixture schedule, WaterMark certified'),
      mat('Tapware and outlets', 'WELS registered with the specified star rating and flow rate'),
      mat('Traps and connectors', 'WaterMark certified traps, flexible connectors to AS 3499 where used'),
      mat('Sealants and fixings', 'Sanitary grade silicone and fixings suitable for the substrate'),
      mat('Accessible fixtures', 'Grab rails, backrests and fixings to AS 1428.1 with tested fixings'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Check delivered fixtures and tapware against the fixture schedule — model, finish, handing and WELS rating.',
        acceptance: 'In accordance with the fixture schedule and the specification. No substitutions without written approval.',
        point: 'X',
        photoHint: 'Fixture labels and schedule references',
      },
      {
        installation: 'Check fixture set out, heights and clearances, including accessible fixtures and circulation space.',
        acceptance:
          'In accordance with the architectural drawings and AS 1428.1 for accessible sanitary facilities. Deviations approved before installation.',
        point: 'H',
        releasedBy: 'Superintendent / Access consultant',
        recordLabel: 'Fixture height',
        recordUnit: 'mm',
        photoHint: 'Installed fixture with measured height and clearances',
      },
      {
        installation: 'Check fixing of fixtures, cisterns, pans and accessories to the substrate, including noggins and rated fixings for grab rails.',
        acceptance:
          "In accordance with the manufacturer's instructions and AS 1428.1 load requirements for grab rails. Fixings suitable for the substrate.",
        point: 'X',
        photoHint: 'Fixing detail behind the fixture before covering',
      },
      {
        installation: 'Check trap and waste connections, including seal depth and access to the connection.',
        acceptance: 'In accordance with AS/NZS 3500.2:2021 Section 10. No flexible connectors where prohibited.',
        point: 'X',
        photoHint: 'Trap and waste connection',
      },
      {
        installation: 'Check silicone sealing and junctions to tiling and benches; confirm falls to floor wastes are maintained.',
        acceptance: 'Neat, continuous sanitary grade sealant. No ponding at fixtures or floor wastes.',
        point: 'X',
        photoHint: 'Sealed junction at the fixture',
      },
      {
        installation: 'Operate every fixture and tap — check flow, isolation, drainage, cistern operation and absence of leaks.',
        acceptance: 'All fixtures operate correctly with no leaks. Flow rates to the WELS rating specified.',
        point: 'X',
        recordLabel: 'Measured flow rate',
        recordUnit: 'L/min',
        photoHint: 'Fixture in operation',
      },
      {
        installation: 'Record hot water delivery temperature at each ablution fixture.',
        acceptance:
          'Not exceeding 45 °C at ablution fixtures in early childhood, primary/secondary school, aged care, health care and accommodation buildings; 50 °C elsewhere, in accordance with AS/NZS 3500.4:2021.',
        point: 'H',
        releasedBy: 'Superintendent / Building certifier',
        recordLabel: 'Delivery temperature',
        recordUnit: '°C',
        photoHint: 'Calibrated thermometer at the outlet',
      },
      {
        installation: 'Final clean, protection and defect inspection of fixtures and tapware.',
        acceptance: 'No chips, scratches or staining. Protection reinstated until handover. Defects register updated.',
        point: 'X',
        photoHint: 'Completed and protected fixtures',
      },
      asBuilt(),
    ],
  }),
]
