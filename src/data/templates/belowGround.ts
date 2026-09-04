import type { ItpTemplate } from '../types'
import {
  airTest,
  asBuilt,
  authorityInspection,
  backfill,
  backflow,
  bedding,
  checkDims,
  disinfection,
  drawingRevision,
  excavation,
  flushing,
  hydrostaticTest,
  identification,
  layAtGrade,
  markerTape,
  mat,
  materialCompliance,
  mk,
  pitsAndCovers,
  pressureTest,
  sealOpenEnds,
  setOut,
  trenchBase,
  trenchDepthCover,
  turnUps,
  weldJoints,
} from './common'

const G = 'Below ground' as const

/** Rows every buried drainage ITP shares, in the order they are carried out. */
const drainageCore = (service: string, materialOptions: string) => [
  drawingRevision(),
  setOut(service, "AS/NZS 3500.2:2021 Section 3 'Drainage Design'"),
  excavation(),
  trenchBase(),
  bedding(),
  materialCompliance(materialOptions),
  layAtGrade(),
  checkDims(),
  turnUps(),
]

export const belowGroundTemplates: ItpTemplate[] = [
  /* ------------------------------------------------------------------ 001 */
  mk({
    code: '001',
    title: 'Inground Sanitary Drainage',
    group: G,
    scope:
      'Buried sanitary drainage from the fixture connection points to the point of connection with the authority sewer, including inspection openings, boundary traps and vents.',
    standards: ['AS/NZS 3500.2:2021', 'AS/NZS 2032', 'AS/NZS 2033', 'AS 2566.2'],
    materials: [
      mat('Sanitary pipework', 'PVC-U DWV to AS/NZS 1260, SN rating as specified, WaterMark certified'),
      mat('Sanitary fittings', 'Solvent weld to AS/NZS 1260, solvent cement to AS/NZS 3879'),
      mat('HDPE pipework (where specified)', 'PE100 to AS/NZS 4130 with electrofusion / butt fusion joints'),
      mat('Bedding and backfill', 'PM 64 quarry sand bedding, PM 2/20 quarry rubble base'),
      mat('Inspection openings and risers', 'Matching pipe material, sealed screw caps to finished surface level'),
    ],
    items: [
      ...drainageCore('sanitary drainage', 'PVC-U DWV / HDPE / VC / other as specified'),
      {
        installation:
          'Check installation of inspection openings, junctions, bends and boundary trap (where required) including access for maintenance.',
        acceptance:
          "In accordance with AS/NZS 3500.2:2021 Section 4 'Sanitary Drainage' and the approved shop drawings. Inspection openings extended to finished surface level.",
        point: 'X',
        photoHint: 'Inspection openings and junction arrangement',
      },
      {
        installation: 'Check vent pipe locations, sizes and connections to the drain.',
        acceptance:
          "In accordance with AS/NZS 3500.2:2021 Section 6 'Venting' and the approved shop drawings.",
        point: 'X',
        photoHint: 'Vent connections at the drain',
      },
      backfill(),
      hydrostaticTest({ minutes: 15 }),
      authorityInspection('Office of the Technical Regulator / Water authority'),
      pitsAndCovers(),
      sealOpenEnds(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 002 */
  mk({
    code: '002',
    title: 'Inground Tradewaste Drainage',
    group: G,
    scope:
      'Buried trade waste drainage from plant, kitchens and wash-down areas to the pre-treatment device and authority point of connection.',
    standards: ['AS/NZS 3500.2:2021', 'Water authority trade waste agreement', 'AS/NZS 2033'],
    materials: [
      mat('Sanitary pipe work', 'HDPE PE100 to AS/NZS 4130, chemical and temperature resistant as specified'),
      mat('Sanitary fittings', 'Electrofusion joints to AS/NZS 4129, jointed by a qualified operator'),
      mat('Alternative pipework', 'PVC-U DWV to AS/NZS 1260 where permitted by the trade waste agreement'),
      mat('Bedding and backfill', 'PM 64 quarry sand bedding, PM 2/20 quarry rubble base'),
      mat('Pre-treatment device', 'Type, capacity and approval number to the trade waste agreement'),
    ],
    items: [
      ...drainageCore('trade waste drainage', 'HDPE / PVC / RCP / other'),
      weldJoints('electrofusion / butt fusion'),
      {
        installation:
          'Confirm the pre-treatment device (grease arrestor, cooling pit, dilution pit, neutralising tank) type, capacity, location and inlet/outlet invert levels.',
        acceptance:
          'In accordance with the water authority trade waste agreement, the approved hydraulic drawings and the manufacturer’s installation instructions.',
        point: 'H',
        releasedBy: 'Water authority (trade waste)',
        recordLabel: 'Trade waste agreement no.',
        photoHint: 'Installed pre-treatment device and inverts',
      },
      backfill(),
      hydrostaticTest({ minutes: 15 }),
      authorityInspection('Office of the Technical Regulator (Inspection)'),
      pitsAndCovers(),
      sealOpenEnds(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 003 */
  mk({
    code: '003',
    title: 'Inground High Temperature Sanitary Drainage',
    group: G,
    scope:
      'Buried drainage receiving discharges above 65 °C, including commercial kitchen, laundry, sterilising and boiler blowdown waste.',
    standards: ['AS/NZS 3500.2:2021', 'AS/NZS 4130', 'AS/NZS 2033', 'Water authority trade waste agreement'],
    materials: [
      mat('High temperature pipework', 'HDPE PE100 to AS/NZS 4130 rated for the design discharge temperature'),
      mat('Jointing', 'Electrofusion / butt fusion to AS/NZS 4129, qualified operator'),
      mat('Cooling / dilution device', 'Capacity and approval to the trade waste agreement'),
      mat('Bedding and backfill', 'PM 64 quarry sand bedding, PM 2/20 quarry rubble base'),
    ],
    items: [
      ...drainageCore('high temperature drainage', 'HDPE PE100 only — PVC not permitted'),
      {
        installation:
          'Verify pipe material and jointing system are rated for the maximum design discharge temperature and that no PVC has been used upstream of the cooling device.',
        acceptance:
          "In accordance with AS/NZS 3500.2:2021 Section 2.3 'Selection and Use of Materials and Products'. Material temperature rating to exceed the maximum recorded discharge temperature.",
        point: 'H',
        releasedBy: 'Hydraulic consultant',
        recordLabel: 'Max design discharge temp.',
        recordUnit: '°C',
        photoHint: 'Pipe markings showing material grade',
      },
      weldJoints('electrofusion / butt fusion'),
      {
        installation: 'Check provision for thermal expansion of the buried HDPE line, including anchor and expansion arrangements.',
        acceptance: "In accordance with the pipe manufacturer's design guidance and the hydraulic specification.",
        point: 'X',
        photoHint: 'Expansion arrangement prior to backfill',
      },
      {
        installation: 'Confirm cooling / dilution pit installed upstream of any temperature-sensitive material or authority connection.',
        acceptance: 'In accordance with the trade waste agreement. Discharge temperature at the point of connection not to exceed the permitted limit.',
        point: 'H',
        releasedBy: 'Water authority (trade waste)',
        recordLabel: 'Temp. at point of connection',
        recordUnit: '°C',
        photoHint: 'Cooling pit and temperature reading',
      },
      backfill(),
      hydrostaticTest({ minutes: 15 }),
      authorityInspection('Office of the Technical Regulator (Inspection)'),
      pitsAndCovers(),
      sealOpenEnds(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 004 */
  mk({
    code: '004',
    title: 'Inground Stormwater Drainage',
    group: G,
    scope:
      'Buried gravity stormwater drainage including downpipe connections, surface inlet pits, subsoil drainage and the legal point of discharge.',
    standards: ['AS/NZS 3500.3:2021', 'AS 3725', 'AS 2566.2', 'AS 3996'],
    materials: [
      mat('Stormwater pipework', 'PVC-U SWV to AS/NZS 1254 or PVC-U to AS/NZS 1260, class as specified'),
      mat('Concrete pipe (where specified)', 'RCP to AS/NZS 4058, class and jointing as specified'),
      mat('Pits and covers', 'Precast or in-situ pits, covers to AS 3996 load class as specified'),
      mat('Bedding and backfill', 'PM 64 quarry sand bedding, PM 2/20 quarry rubble base'),
      mat('Subsoil drainage', 'Slotted / perforated pipe with geotextile sock and aggregate surround'),
    ],
    items: [
      ...drainageCore('stormwater drainage', 'PVC-U SWV / PVC-U / RCP / HDPE'),
      {
        installation:
          'Check pit locations, sizes, invert levels, benching and step irons; confirm surface inlet grates match the civil finished surface levels.',
        acceptance:
          'In accordance with AS/NZS 3500.3:2021, the approved hydraulic and civil drawings, and AS 3996 for the nominated load class.',
        point: 'X',
        photoHint: 'Pit internals showing benching and inverts',
      },
      {
        installation: 'Check subsoil drainage installation, geotextile wrap, aggregate surround and connection to the stormwater system.',
        acceptance: 'In accordance with the approved drawings and the hydraulic specification. Subsoil not to be connected upstream of a silt trap where prohibited.',
        point: 'X',
        photoHint: 'Subsoil line, sock and aggregate',
      },
      backfill(),
      hydrostaticTest({ minutes: 15, std: "AS/NZS 3500.3:2021 Section 15 'Testing'" }),
      authorityInspection('Council / Water authority'),
      pitsAndCovers(),
      sealOpenEnds(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 005 */
  mk({
    code: '005',
    title: 'Inground Stormwater Rising Mains',
    group: G,
    scope: 'Buried pressurised stormwater discharge mains from pump stations to the point of discharge.',
    standards: ['AS/NZS 3500.3:2021', 'AS/NZS 2033', 'AS/NZS 4130', 'AS 2566.2'],
    materials: [
      mat('Rising main pipework', 'PE100 PN rating to AS/NZS 4130 or PVC-U pressure pipe to AS/NZS 1477, class as specified'),
      mat('Fittings and jointing', 'Electrofusion / butt fusion to AS/NZS 4129, or solvent weld pressure fittings'),
      mat('Valves', 'Non-return and isolation valves to the specified pressure class, located in accessible pits'),
      mat('Thrust restraint', 'Thrust blocks or restrained joints at all changes of direction'),
      mat('Marker tape', 'Detectable marker tape and tracer wire'),
    ],
    items: [
      drawingRevision(),
      setOut('stormwater rising main', "AS/NZS 3500.3:2021 and AS 2566.2 'Buried Flexible Pipelines — Installation'"),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 / PVC-U pressure pipe, PN class as specified'),
      weldJoints('electrofusion / butt fusion / solvent weld'),
      {
        installation: 'Check thrust restraint at bends, tees and valves, including thrust block dimensions and concrete strength.',
        acceptance: 'In accordance with the approved drawings and AS 2566.2. Concrete cured before pressure testing.',
        point: 'X',
        photoHint: 'Thrust block prior to backfill',
      },
      {
        installation: 'Check non-return valve, isolation valve and air release / scour arrangements including access pits.',
        acceptance: 'In accordance with the approved hydraulic drawings. Valves accessible, correctly oriented and labelled.',
        point: 'X',
        photoHint: 'Valve arrangement in pit',
      },
      trenchDepthCover('600 mm (750 mm under trafficable areas) or as specified', 'AS 2566.2 and the hydraulic specification'),
      markerTape('stormwater rising main', 'Detectable'),
      pressureTest(1000, 60, "AS/NZS 3500.3:2021 Section 15 'Testing' and AS 2566.2"),
      backfill(),
      pitsAndCovers(),
      {
        installation: 'Run the pump station and confirm the rising main discharges to the nominated point without leakage or surge damage.',
        acceptance: 'No leakage under operating conditions. Discharge point stable and erosion protected.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Discharge under running conditions',
      },
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 006 */
  mk({
    code: '006',
    title: 'Inground Siphonic Drainage',
    group: G,
    scope:
      'Buried components of a siphonic roof drainage system, from the base of the tail pipe / break pressure point to the gravity stormwater system.',
    standards: ['AS/NZS 3500.3:2021', "Siphonic system designer's certified design", 'AS/NZS 2033'],
    materials: [
      mat('Siphonic pipework', 'HDPE PE100 to AS/NZS 4130 to the certified siphonic design, full vacuum rated'),
      mat('Jointing', 'Electrofusion / butt fusion to AS/NZS 4129 by a qualified operator'),
      mat('Bracketing and restraint', 'Proprietary siphonic bracketry and rail system to the designer’s details'),
      mat('Transition to gravity', 'Break pressure chamber / vented transition to the certified design'),
    ],
    items: [
      drawingRevision(),
      {
        installation:
          'Confirm the siphonic system design has been certified by the siphonic designer and that the drawings on site match the certified calculation set.',
        acceptance:
          'Certified siphonic design and calculations issued for construction. Any deviation to be re-certified before installation — no substitution of pipe size or route.',
        point: 'H',
        releasedBy: 'Siphonic system designer',
        recordLabel: 'Certified design reference',
        photoHint: 'Certified design cover sheet and calculation summary',
      },
      setOut('siphonic drainage', 'the certified siphonic design'),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('HDPE PE100 to the certified siphonic design — no substitution permitted'),
      weldJoints('electrofusion / butt fusion'),
      {
        installation: 'Check pipe diameters and routing against the certified design, item by item, including all reducers.',
        acceptance:
          'Every diameter, length and fitting to match the certified siphonic calculation. Deviations recorded and re-certified prior to backfill.',
        point: 'H',
        releasedBy: 'Siphonic system designer',
        photoHint: 'Installed run with diameter markings visible',
      },
      {
        installation: 'Check the break pressure / transition chamber to the gravity system, including venting and invert levels.',
        acceptance: 'In accordance with the certified design and AS/NZS 3500.3:2021.',
        point: 'X',
        photoHint: 'Transition chamber arrangement',
      },
      backfill(),
      hydrostaticTest({ minutes: 15, std: "AS/NZS 3500.3:2021 Section 15 'Testing'" }),
      {
        installation: 'Wet weather / simulated flow test of the completed siphonic system to confirm priming and full bore flow.',
        acceptance: 'System primes and runs full bore within the time stated in the certified design, with no surcharge or noise defects.',
        point: 'W',
        releasedBy: 'Siphonic system designer / Superintendent',
        photoHint: 'Test flow at outlets and discharge point',
      },
      pitsAndCovers(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 007 */
  mk({
    code: '007',
    title: 'Inground Fuel and Stormwater Drainage',
    group: G,
    scope:
      'Buried drainage from fuel handling, loading and hardstand areas through a fuel / oil water separator to the point of discharge.',
    standards: ['AS/NZS 3500.3:2021', 'AS 1940', 'Water authority trade waste agreement', 'EPA requirements'],
    materials: [
      mat('Drainage pipework', 'Fuel resistant pipework as specified — HDPE PE100 to AS/NZS 4130 or as approved'),
      mat('Separator', 'Fuel / oil water separator, class and capacity to the approved design and trade waste agreement'),
      mat('Pits and covers', 'Sealed, fuel resistant, covers to AS 3996 load class as specified'),
      mat('Bunding / grading', 'Falls to contain spills within the treated catchment'),
    ],
    items: [
      drawingRevision(),
      setOut('fuel and stormwater drainage', "AS/NZS 3500.3:2021 and AS 1940 'The Storage and Handling of Flammable and Combustible Liquids'"),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('Fuel resistant pipework and seals as specified — confirm chemical compatibility'),
      {
        installation:
          'Confirm the catchment served drains only the nominated fuel handling area, and that clean stormwater is not connected upstream of the separator.',
        acceptance: 'In accordance with the approved civil and hydraulic drawings, AS 1940 and the trade waste agreement.',
        point: 'H',
        releasedBy: 'Water authority / EPA',
        photoHint: 'Catchment extents and grading',
      },
      layAtGrade(),
      checkDims(),
      {
        installation: 'Check separator installation — bedding, levels, orientation, inlet/outlet inverts, bypass and sampling point.',
        acceptance: "In accordance with the manufacturer's installation instructions, AS 1940 and the trade waste agreement.",
        point: 'H',
        releasedBy: 'Water authority (trade waste)',
        recordLabel: 'Separator serial no.',
        photoHint: 'Separator set in position with inverts',
      },
      {
        installation: 'Check accessible sampling point downstream of the separator.',
        acceptance: 'Sampling point installed, accessible and marked in accordance with the trade waste agreement.',
        point: 'X',
        photoHint: 'Sampling point and marking',
      },
      backfill(),
      hydrostaticTest({ minutes: 15, std: "AS/NZS 3500.3:2021 Section 15 'Testing'" }),
      authorityInspection('Water authority / EPA'),
      pitsAndCovers(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 008 */
  mk({
    code: '008',
    title: 'Inground Potable Water',
    group: G,
    scope:
      'Buried potable cold water mains from the authority meter / point of connection to the building entry, including valves, hydrant-free branches and backflow protection.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 4020', 'AS/NZS 2033', 'AS 2845.1'],
    materials: [
      mat('Water main pipework', 'PE100 blue stripe to AS/NZS 4130 or copper to AS 1432, class as specified'),
      mat('Fittings', 'Electrofusion / compression fittings to AS/NZS 4129 or AS 3688, WaterMark certified'),
      mat('Drinking water suitability', 'All wetted products certified to AS/NZS 4020'),
      mat('Valves', 'Resilient seated gate / ball valves in accessible surface boxes'),
      mat('Marker tape', 'Blue detectable marker tape and tracer wire'),
    ],
    items: [
      drawingRevision(),
      setOut('potable water main', "AS/NZS 3500.1:2021 Section 3 'Design and Installation of Water Services'"),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 blue stripe / copper Type B — WaterMark and AS/NZS 4020 certified'),
      weldJoints('electrofusion / butt fusion / compression'),
      {
        installation:
          'Check separation from sewer, trade waste and other services, both horizontally and vertically, including at crossings.',
        acceptance:
          "In accordance with AS/NZS 3500.1:2021 Section 5 'Water Service Installation' clearance requirements and the water authority requirements.",
        point: 'X',
        photoHint: 'Service crossing showing measured separation',
      },
      trenchDepthCover('450 mm (600 mm under trafficable areas) or as specified by the water authority', 'AS/NZS 3500.1:2021'),
      markerTape('potable water main', 'Blue'),
      pitsAndCovers(),
      backflow(),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      backfill(),
      flushing(),
      disinfection(),
      identification('potable water main', 'Blue / "POTABLE WATER"'),
      authorityInspection('Water authority / Office of the Technical Regulator'),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 009 */
  mk({
    code: '009',
    title: 'Inground Non Potable Water',
    group: G,
    scope:
      'Buried non-potable (recycled, rainwater reuse or bore) water mains, including identification, separation and cross-connection control.',
    standards: ['AS/NZS 3500.1:2021', 'AS 2845.1', 'AS 1345', 'AS 2700'],
    materials: [
      mat('Non-potable pipework', 'PE100 with lilac / purple stripe to AS/NZS 4130, class as specified'),
      mat('Fittings', 'Electrofusion / compression fittings to AS/NZS 4129, WaterMark certified'),
      mat('Identification', 'Lilac (Wisteria) identification and "NON-POTABLE WATER — DO NOT DRINK" signage'),
      mat('Valves and outlets', 'Lockable / removable-key outlets to prevent unauthorised use'),
      mat('Marker tape', 'Lilac detectable marker tape and tracer wire'),
    ],
    items: [
      drawingRevision(),
      setOut('non-potable water main', "AS/NZS 3500.1:2021 Section 3 'Design and Installation of Water Services'"),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 lilac stripe — confirm no potable-marked pipe has been used'),
      weldJoints('electrofusion / butt fusion / compression'),
      {
        installation:
          'Verify there is no cross-connection between the non-potable and potable systems. Carry out a documented cross-connection check of the whole system.',
        acceptance:
          "In accordance with AS/NZS 3500.1:2021 Section 4 'Cross-connection Control' and the water authority requirements. Cross-connection test certificate provided.",
        point: 'H',
        releasedBy: 'Water authority / Superintendent',
        recordLabel: 'Cross-connection test ref.',
        photoHint: 'Test in progress and completed certificate',
      },
      trenchDepthCover('450 mm (600 mm under trafficable areas) or as specified', 'AS/NZS 3500.1:2021'),
      markerTape('non-potable water main', 'Lilac'),
      identification('non-potable water main', 'Lilac (Wisteria) with "NON-POTABLE WATER — DO NOT DRINK"'),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      backfill(),
      pitsAndCovers(),
      flushing(),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 010 */
  mk({
    code: '010',
    title: 'Inground Natural Gas',
    group: G,
    scope:
      'Buried natural gas consumer piping from the meter / point of supply to building entry, including transition fittings, valves and purging.',
    standards: ['AS/NZS 5601.1:2022', 'AS/NZS 4130', 'AS/NZS 2033', 'Gas distributor requirements'],
    materials: [
      mat('Gas pipework', 'PE100 yellow stripe gas grade to AS/NZS 4130, SDR as specified'),
      mat('Fittings', 'Electrofusion fittings to AS/NZS 4129 gas grade, jointed by a qualified operator'),
      mat('Transitions', 'PE to steel / copper transition fittings, above ground where required'),
      mat('Identification', 'Yellow detectable marker tape and tracer wire'),
      mat('Valves', 'Gas isolation valve in an accessible, identified surface box'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Confirm the gas fitter holds current licensing and the works are notified to the gas distributor / Technical Regulator.',
        acceptance:
          'Licensed gas fitter, works notified in accordance with AS/NZS 5601.1:2022 and the gas distributor requirements.',
        point: 'H',
        releasedBy: 'Office of the Technical Regulator / Gas distributor',
        recordLabel: 'Notification / job no.',
      },
      setOut('natural gas consumer piping', 'AS/NZS 5601.1:2022 and the gas distributor requirements'),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 yellow stripe gas grade — confirm SDR and gas grade markings'),
      weldJoints('electrofusion'),
      {
        installation: 'Check separation from other services and from building footings, including at crossings.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 5 and the gas distributor requirements.',
        point: 'X',
        photoHint: 'Measured separation at a crossing',
      },
      trenchDepthCover('450 mm (600 mm under trafficable areas) or as required by AS/NZS 5601.1', 'AS/NZS 5601.1:2022'),
      markerTape('natural gas main', 'Yellow'),
      {
        installation: 'Check PE to metallic transition fitting location, support and corrosion protection.',
        acceptance: "In accordance with AS/NZS 5601.1:2022 and the fitting manufacturer's instructions.",
        point: 'X',
        photoHint: 'Transition fitting arrangement',
      },
      {
        installation: 'Pressure / leakage test the consumer piping prior to backfill and connection.',
        acceptance:
          "Test pressure and duration in accordance with AS/NZS 5601.1:2022 Section 5.3 'Testing for Leakage' with no measurable pressure drop.",
        point: 'H',
        releasedBy: 'Office of the Technical Regulator / Gas distributor',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Calibrated gauge at start and end of test',
      },
      backfill(),
      pitsAndCovers(),
      {
        installation: 'Purge the consumer piping and commission the installation. Check all appliances and isolation valves.',
        acceptance: "In accordance with AS/NZS 5601.1:2022 Section 6 'Commissioning and Decommissioning'.",
        point: 'W',
        releasedBy: 'Gas distributor / Superintendent',
        photoHint: 'Purge point and completed gas compliance certificate',
      },
      identification('gas main', 'Yellow / "GAS"'),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 011 */
  mk({
    code: '011',
    title: 'Inground LPG Gas',
    group: G,
    scope:
      'Buried LP Gas consumer piping from the vessel / cylinder installation and first stage regulator to the building, including vessel siting and separation distances.',
    standards: ['AS/NZS 5601.1:2022', 'AS/NZS 1596:2014', 'AS/NZS 4130'],
    materials: [
      mat('Gas pipework', 'PE100 yellow stripe gas grade to AS/NZS 4130, SDR as specified'),
      mat('Fittings', 'Electrofusion fittings to AS/NZS 4129 gas grade'),
      mat('Vessel / cylinders', 'Capacity, siting and restraint to AS/NZS 1596'),
      mat('Regulators', 'First and second stage regulators, relief vent terminations as specified'),
      mat('Identification', 'Yellow detectable marker tape and tracer wire'),
    ],
    items: [
      drawingRevision(),
      {
        installation:
          'Confirm the LP Gas vessel / cylinder location, hardstand, restraint and separation distances to boundaries, openings, ignition sources and vehicle traffic.',
        acceptance: "In accordance with AS/NZS 1596:2014 'The Storage and Handling of LP Gas' separation tables and the approved site plan.",
        point: 'H',
        releasedBy: 'Office of the Technical Regulator',
        recordLabel: 'Min. separation achieved',
        recordUnit: 'm',
        photoHint: 'Vessel location with measured separation distances',
      },
      setOut('LP Gas consumer piping', 'AS/NZS 5601.1:2022 and AS/NZS 1596:2014'),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 yellow stripe gas grade rated for LP Gas service'),
      weldJoints('electrofusion'),
      {
        installation: 'Check first and second stage regulator installation, relief vent terminations and protection from damage.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 and AS/NZS 1596:2014. Vents terminate in a safe, ventilated location.',
        point: 'X',
        photoHint: 'Regulator set and vent terminations',
      },
      trenchDepthCover('450 mm (600 mm under trafficable areas) or as required by AS/NZS 5601.1', 'AS/NZS 5601.1:2022'),
      markerTape('LP Gas main', 'Yellow'),
      {
        installation: 'Pressure / leakage test the consumer piping prior to backfill and connection.',
        acceptance: "Test pressure and duration in accordance with AS/NZS 5601.1:2022 Section 5.3 'Testing for Leakage' with no measurable pressure drop.",
        point: 'H',
        releasedBy: 'Office of the Technical Regulator',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Gauge reading during test',
      },
      backfill(),
      {
        installation: 'Purge, commission and check operation of the LP Gas installation. Install required signage and fire extinguisher.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 Section 6 and AS/NZS 1596:2014 signage requirements. Gas compliance certificate issued.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Signage, extinguisher and compliance certificate',
      },
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 012 */
  mk({
    code: '012',
    title: 'Inground Fire Hydrant Service',
    group: G,
    scope:
      'Buried fire hydrant mains from the point of connection / booster to the building and to external feed hydrants, including valves, thrust restraint and flow testing.',
    standards: ['AS 2419.1:2021', 'AS/NZS 3500.1:2021', 'AS 2566.2', 'AS/NZS 2033'],
    materials: [
      mat('Hydrant main pipework', 'PE100 red stripe to AS/NZS 4130 or ductile iron to AS/NZS 2280, PN class as specified'),
      mat('Fittings', 'Electrofusion / flanged fittings rated to the system pressure'),
      mat('Valves', 'Resilient seated gate valves, lockable open, in identified surface boxes'),
      mat('Hydrants', 'Feed / attack hydrants to AS 2419.1 with landing valves as specified'),
      mat('Thrust restraint', 'Thrust blocks or restrained joints at all changes of direction'),
    ],
    items: [
      drawingRevision(),
      setOut('fire hydrant main', 'AS 2419.1:2021 and the approved fire services drawings'),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 red stripe / ductile iron — confirm PN rating suits the system design pressure'),
      weldJoints('electrofusion / flanged'),
      {
        installation: 'Check thrust restraint at bends, tees, valves and hydrant risers, including concrete strength and curing.',
        acceptance: 'In accordance with the approved drawings and AS 2566.2. Concrete cured before pressure testing.',
        point: 'X',
        photoHint: 'Thrust block prior to backfill',
      },
      {
        installation: 'Check hydrant locations, coverage, hardstand access and clearances to the building and obstructions.',
        acceptance: "In accordance with AS 2419.1:2021 Section 3 'Location of Hydrants' and the fire engineering report.",
        point: 'H',
        releasedBy: 'Fire engineer / Building surveyor',
        photoHint: 'Hydrant position with measured clearances',
      },
      trenchDepthCover('600 mm (750 mm under trafficable areas) or as specified', 'AS 2419.1:2021 and AS 2566.2'),
      markerTape('fire hydrant main', 'Red'),
      pressureTest(1700, 120, "AS 2419.1:2021 Section 9 'Testing and Commissioning'"),
      backfill(),
      pitsAndCovers(),
      {
        installation: 'Flush the main and carry out the hydrant flow and pressure test at the hydraulically most disadvantaged hydrant.',
        acceptance:
          "Flow and residual pressure to meet the requirements of AS 2419.1:2021 Section 2 and the fire engineering report. Results recorded on the commissioning certificate.",
        point: 'H',
        releasedBy: 'Fire engineer / Certifier',
        recordLabel: 'Flow / residual pressure',
        recordUnit: 'L/s @ kPa',
        photoHint: 'Flow test with gauge and pitot readings',
      },
      identification('fire hydrant main', 'Red / "FIRE SERVICE"'),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 013 */
  mk({
    code: '013',
    title: 'Inground Fire Sprinkler Service',
    group: G,
    scope:
      'Buried fire sprinkler supply mains from the point of connection / tank / pump set to the sprinkler valve set, including thrust restraint and flushing.',
    standards: ['AS 2118.1:2017', 'AS 2419.1:2021', 'AS 2566.2', 'AS/NZS 2033'],
    materials: [
      mat('Sprinkler main pipework', 'PE100 red stripe to AS/NZS 4130 or ductile iron to AS/NZS 2280, PN class as specified'),
      mat('Fittings', 'Electrofusion / flanged fittings rated to the system design pressure'),
      mat('Valves', 'Resilient seated gate valves, monitored / locked open as required'),
      mat('Thrust restraint', 'Thrust blocks or restrained joints at all changes of direction'),
      mat('Marker tape', 'Red detectable marker tape and tracer wire'),
    ],
    items: [
      drawingRevision(),
      setOut('fire sprinkler supply main', 'AS 2118.1:2017 and the approved fire services drawings'),
      excavation(),
      trenchBase(),
      bedding(),
      materialCompliance('PE100 red stripe / ductile iron — PN rating to suit the sprinkler system design pressure'),
      weldJoints('electrofusion / flanged'),
      {
        installation: 'Check thrust restraint at all changes of direction and at the riser into the valve set.',
        acceptance: 'In accordance with the approved drawings and AS 2566.2. Concrete cured before pressure testing.',
        point: 'X',
        photoHint: 'Thrust restraint prior to backfill',
      },
      trenchDepthCover('600 mm (750 mm under trafficable areas) or as specified', 'AS 2118.1:2017 and AS 2566.2'),
      markerTape('fire sprinkler main', 'Red'),
      {
        installation: 'Hydrostatically test the buried supply main prior to backfill and connection to the valve set.',
        acceptance:
          "Test pressure of 1400 kPa, or 350 kPa above the maximum static pressure where that is greater, held for 2 hours with no loss, in accordance with AS 2118.1:2017 Section 17 'Testing and Commissioning'.",
        point: 'H',
        releasedBy: 'Fire services certifier',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Gauge at start and end of the 2 hour test',
      },
      backfill(),
      pitsAndCovers(),
      {
        installation: 'Flush the buried main at the required velocity before connection to the sprinkler valve set.',
        acceptance:
          'Flushing carried out at the flow rate and duration required by AS 2118.1:2017 until the discharge runs clear. Flushing certificate provided.',
        point: 'H',
        releasedBy: 'Fire services certifier',
        recordLabel: 'Flushing flow rate',
        recordUnit: 'L/s',
        photoHint: 'Flushing discharge and record sheet',
      },
      identification('fire sprinkler main', 'Red / "SPRINKLER SERVICE"'),
      asBuilt(),
    ],
  }),

  /* ------------------------------------------------------------------ 014 */
  mk({
    code: '014',
    title: 'Decks and Cast In Drainage',
    group: G,
    scope:
      'Drainage cast into suspended slabs and decks — set out of penetrations, cast-in pipework, floor wastes, puddle flanges and pre-pour inspection.',
    standards: ['AS/NZS 3500.2:2021', 'AS 3600', 'AS 4654.2', 'AS 4072.1'],
    materials: [
      mat('Cast-in pipework', 'PVC-U DWV to AS/NZS 1260 or HDPE to AS/NZS 4130, as specified'),
      mat('Floor wastes and puddle flanges', 'Type, flange and clamping ring to suit the waterproofing system'),
      mat('Penetration formers', 'Void formers / box-outs sized and sealed to prevent grout loss'),
      mat('Fire collars', 'Tested system to AS 4072.1 matching the FRL of the slab'),
    ],
    items: [
      drawingRevision(),
      {
        installation:
          'Set out all penetrations, floor wastes and cast-in pipework against the coordinated services and structural drawings. Confirm no clash with reinforcement, post-tensioning or structural elements.',
        acceptance:
          'In accordance with the coordinated shop drawings and the structural engineer’s penetration limits. Post-tensioned slabs scanned and marked before any penetration.',
        point: 'H',
        releasedBy: 'Structural engineer',
        photoHint: 'Set out marks on deck with grid references',
      },
      {
        installation: 'Check penetration sizes, positions and levels against the set out, including tolerance to finished floor level.',
        acceptance: 'Within the tolerance stated in the hydraulic specification. Deviations recorded and approved before the pour.',
        point: 'X',
        recordLabel: 'Max deviation',
        recordUnit: 'mm',
        photoHint: 'Penetration positions measured to grid',
      },
      {
        installation:
          'Check cast-in pipework, floor wastes and puddle flanges are securely fixed, capped and protected against grout ingress and displacement during the pour.',
        acceptance:
          "Fixed to prevent movement, all ends capped. In accordance with AS/NZS 3500.2:2021 and the manufacturer's instructions.",
        point: 'X',
        photoHint: 'Fixed and capped cast-in items',
      },
      {
        installation: 'Check falls to floor wastes and set-downs are achievable with the proposed slab levels and screed depths.',
        acceptance: 'Falls in accordance with AS 3740 / AS 4654.2 and the architectural details. Set-downs confirmed prior to the pour.',
        point: 'X',
        photoHint: 'Floor waste with set-down and levels',
      },
      {
        installation: 'Pre-pour inspection of all hydraulic cast-in items.',
        acceptance: 'All items inspected, positions confirmed and released for pour. No pour to proceed without release.',
        point: 'H',
        releasedBy: 'Superintendent / Head contractor',
        photoHint: 'Deck ready for pour showing hydraulic items',
      },
      {
        installation: 'Post-pour inspection — confirm nothing has moved, been damaged or been blocked. Remove formers and clean out.',
        acceptance: 'All penetrations clear and to the approved position. Damage rectified before the deck is handed over.',
        point: 'X',
        photoHint: 'Penetrations after strip and clean out',
      },
      {
        installation: 'Install fire collars and seals to penetrations through rated slabs.',
        acceptance: 'In accordance with AS 4072.1 and the tested system, matching the FRL of the slab. Products labelled and register updated.',
        point: 'S',
        releasedBy: 'Fire engineer / Building surveyor',
        photoHint: 'Installed collar with product label',
      },
      {
        installation: 'Water test cast-in drainage and floor wastes prior to waterproofing.',
        acceptance: "Held for a minimum of 15 minutes with no loss, in accordance with AS/NZS 3500.2:2021 Section 15 'Testing'.",
        point: 'W',
        releasedBy: 'Superintendent / Waterproofing contractor',
        photoHint: 'Water test in progress at floor waste',
      },
      airTest(30, 15),
      asBuilt(),
    ],
  }),
]
