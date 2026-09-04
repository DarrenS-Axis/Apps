import type { ItpTemplate } from '../types'
import {
  backflow,
  commissioning,
  defectsCheck,
  disinfection,
  drawingRevision,
  flushing,
  handover,
  identification,
  insulation,
  mat,
  materialCompliance,
  mk,
  pressureTest,
  valveOperation,
} from './common'

const G = 'Plant & equipment' as const

/** Rows shared by every plant / packaged equipment ITP. */
const plantCore = (equipment: string) => [
  drawingRevision(),
  {
    installation: `Check delivered ${equipment} against the approved technical submission — make, model, capacity, duty, serial number and any damage in transit.`,
    acceptance:
      'Equipment as per the approved technical submission and schedule. No substitution without written approval. Damage reported before installation.',
    point: 'H' as const,
    releasedBy: 'Superintendent / Hydraulic consultant',
    recordLabel: 'Serial number',
    photoHint: 'Nameplate showing make, model and serial number',
  },
  {
    installation: `Check the plinth, base, bunding, structural support and access clearances for the ${equipment}.`,
    acceptance:
      "In accordance with the manufacturer's installation instructions, the structural drawings and the maintenance access clearances shown on the approved drawings.",
    point: 'X' as const,
    photoHint: 'Equipment on its plinth with access clearances',
  },
]

const electricalInterface = (): {
  installation: string
  acceptance: string
  point: 'S'
  releasedBy: string
  photoHint: string
} => ({
  installation:
    'Confirm electrical supply, isolation, controls and BMS interface have been installed and terminated by the electrical contractor, and that the equipment has been energised safely.',
  acceptance:
    'In accordance with AS/NZS 3000, the electrical drawings and the equipment manufacturer’s requirements. Electrical certificate of compliance provided.',
  point: 'S',
  releasedBy: 'Electrical contractor / Superintendent',
  photoHint: 'Isolator, control panel and terminations',
})

const vibrationNoise = () => ({
  installation: 'Check anti-vibration mounts, flexible connections and acoustic treatment.',
  acceptance: 'In accordance with the acoustic report and the manufacturer’s requirements. No rigid bridging across flexible connections.',
  point: 'X' as const,
  photoHint: 'AV mounts and flexible connections',
})

export const plantTemplates: ItpTemplate[] = [
  /* ------------------------------------------------------------------ 030 */
  mk({
    code: '030',
    title: 'Sewer Pumps and Holding Well',
    group: G,
    scope:
      'Packaged sewage pump station and holding well — well construction, pumps, guide rails, level controls, ventilation, odour control and commissioning.',
    standards: ['AS/NZS 3500.2:2021', 'AS/NZS 3000', 'AS 1657', 'AS 2865'],
    materials: [
      mat('Pump set', 'Duty / standby submersible sewage pumps, duty to the approved schedule'),
      mat('Holding well', 'Well material, capacity, benching and anti-flotation to the approved design'),
      mat('Guide rails and lifting', 'Stainless guide rails, lifting chains and davit / lifting point rated and tagged'),
      mat('Level control', 'Level sensing, high level alarm and control panel to the approved submission'),
      mat('Access covers', 'Lockable, gas-tight covers to the specified load class with fall protection'),
    ],
    items: [
      ...plantCore('sewage pump set and holding well'),
      {
        installation: 'Check holding well construction, benching, invert levels, anti-flotation provisions and water tightness.',
        acceptance: 'In accordance with the approved structural and hydraulic drawings. Well proven water tight before backfill.',
        point: 'H',
        releasedBy: 'Superintendent / Structural engineer',
        photoHint: 'Well interior showing benching and inlet invert',
      },
      {
        installation: 'Check the effective storage volume between start and high level alarm against the design retention time.',
        acceptance: 'In accordance with the approved design. Retention time not to exceed the limit that causes septicity.',
        point: 'X',
        recordLabel: 'Effective volume',
        recordUnit: 'L',
        photoHint: 'Level settings marked on the well',
      },
      {
        installation: 'Check pump installation, guide rails, pedestal seating, lifting chains and clearance for pump removal.',
        acceptance: "In accordance with the manufacturer's instructions. Pumps seat correctly and can be withdrawn without entry to the well.",
        point: 'X',
        photoHint: 'Pump on pedestal with guide rails and lifting chain',
      },
      {
        installation: 'Check discharge pipework, non-return and isolation valves, and provision for flushing / rodding.',
        acceptance: 'In accordance with the approved drawings. Valves accessible from outside the well where practicable.',
        point: 'X',
        photoHint: 'Discharge valve arrangement',
      },
      {
        installation: 'Check ventilation, odour control and confined space signage; confirm covers are gas-tight, lockable and load rated.',
        acceptance: 'In accordance with AS 2865 confined space requirements, AS 3996 for the cover load class, and the specification.',
        point: 'X',
        photoHint: 'Vent, covers and confined space signage',
      },
      electricalInterface(),
      {
        installation: 'Check level control settings, alarm set points, duty / standby alternation and high level alarm signalling to the BMS.',
        acceptance: 'Set points as per the approved control philosophy. High level alarm proven to the BMS / autodialler.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Control panel with settings displayed',
      },
      commissioning('sewage pump station', "AS/NZS 3500.2:2021 Section 12 'Pumped Systems' and the manufacturer's commissioning procedure"),
      {
        installation: 'Wet test — fill the well and prove start, stop, alternation, high level alarm, run-on and no-flow conditions on both pumps.',
        acceptance: 'All functions proven on duty and standby pumps. Flow rate and run times recorded.',
        point: 'H',
        releasedBy: 'Superintendent',
        recordLabel: 'Pump flow rate',
        recordUnit: 'L/s',
        photoHint: 'Wet test in progress with panel indications',
      },
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 031 */
  mk({
    code: '031',
    title: 'Stormwater Pumps',
    group: G,
    scope:
      'Stormwater / seepage pump stations — sump construction, pumps, level controls, discharge arrangement and commissioning.',
    standards: ['AS/NZS 3500.3:2021', 'AS/NZS 3000', 'AS 2865'],
    materials: [
      mat('Pump set', 'Duty / standby submersible drainage pumps, duty to the approved schedule'),
      mat('Sump', 'Sump size, benching and silt trap arrangement to the approved design'),
      mat('Level control', 'Level sensing, high level alarm and control panel to the approved submission'),
      mat('Discharge pipework', 'Rated to the pump shut-off head, with non-return and isolation valves'),
      mat('Access covers', 'Load rated, lockable covers with fall protection'),
    ],
    items: [
      ...plantCore('stormwater pump set'),
      {
        installation: 'Check sump construction, invert levels, silt trap and effective storage volume.',
        acceptance: 'In accordance with the approved drawings. Sump proven water tight and free of construction debris before commissioning.',
        point: 'X',
        recordLabel: 'Effective volume',
        recordUnit: 'L',
        photoHint: 'Sump interior and levels',
      },
      {
        installation: 'Check pump installation, seating, lifting arrangement and clearances for withdrawal.',
        acceptance: "In accordance with the manufacturer's instructions. Pumps withdrawable without entry to the sump.",
        point: 'X',
        photoHint: 'Pumps in sump with lifting chains',
      },
      {
        installation: 'Check discharge pipework, valves, and the discharge point including erosion protection and backflow from the receiving system.',
        acceptance: 'In accordance with AS/NZS 3500.3:2021 and the approved drawings. No surcharge back into the sump.',
        point: 'X',
        photoHint: 'Discharge arrangement',
      },
      electricalInterface(),
      vibrationNoise(),
      {
        installation: 'Check level control settings, duty / standby alternation and high level alarm signalling.',
        acceptance: 'Set points as per the approved control philosophy. Alarm proven to the BMS.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Control panel with settings',
      },
      commissioning('stormwater pump station', "AS/NZS 3500.3:2021 and the manufacturer's commissioning procedure"),
      {
        installation: 'Wet test — prove start, stop, alternation, high level alarm and no-flow protection on both pumps.',
        acceptance: 'All functions proven. Flow rate and run times recorded on the commissioning sheet.',
        point: 'H',
        releasedBy: 'Superintendent',
        recordLabel: 'Pump flow rate',
        recordUnit: 'L/s',
        photoHint: 'Wet test with panel indications',
      },
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 032 */
  mk({
    code: '032',
    title: 'Fuel Oil Water Separator System',
    group: G,
    scope:
      'Fuel / oil water separator system — installation, coalescing media, alarms, sampling, bypass and commissioning to the trade waste and EPA requirements.',
    standards: ['AS 1940', 'Water authority trade waste agreement', 'EPA requirements', 'AS/NZS 3000'],
    materials: [
      mat('Separator unit', 'Class and treatment capacity to the approved design and trade waste agreement'),
      mat('Coalescing media', 'Type and grade as supplied by the manufacturer'),
      mat('Oil level alarm', 'High oil / high level alarm with local and remote indication'),
      mat('Sampling point', 'Accessible sampling chamber downstream of the separator'),
      mat('Covers', 'Gas-tight, load rated, lockable covers'),
    ],
    items: [
      ...plantCore('fuel / oil water separator'),
      {
        installation: 'Check separator installation — bedding, levels, orientation, anti-flotation and inlet / outlet invert levels.',
        acceptance: "In accordance with the manufacturer's installation instructions, AS 1940 and the approved drawings.",
        point: 'H',
        releasedBy: 'Water authority (trade waste)',
        photoHint: 'Separator set in position with invert levels',
      },
      {
        installation: 'Verify the treatment capacity against the design catchment area and the first flush requirement.',
        acceptance: 'Capacity to meet the trade waste agreement and the approved design for the connected catchment.',
        point: 'X',
        recordLabel: 'Treatment capacity',
        recordUnit: 'L/s',
        photoHint: 'Nameplate showing capacity',
      },
      {
        installation: 'Check coalescing media installation, bypass arrangement and internal baffles.',
        acceptance: "Installed in accordance with the manufacturer's instructions. Media clean and correctly seated.",
        point: 'X',
        photoHint: 'Coalescing media in position',
      },
      {
        installation: 'Check the sampling point downstream of the separator for access, identification and compliance with the trade waste agreement.',
        acceptance: 'Sampling point installed, accessible and marked as required by the trade waste agreement.',
        point: 'X',
        photoHint: 'Sampling chamber and identification',
      },
      electricalInterface(),
      {
        installation: 'Commission the high oil / high level alarm and prove local and remote (BMS) indication.',
        acceptance: 'Alarm proven at the design set point with local and remote indication. Alarm response procedure provided.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Alarm test with indication',
      },
      {
        installation: 'Fill, water test and commission the separator system; take a baseline discharge sample where required.',
        acceptance:
          'No leakage. Discharge quality within the limits of the trade waste agreement / EPA licence. NATA laboratory results provided where required.',
        point: 'H',
        releasedBy: 'Water authority / EPA',
        recordLabel: 'Lab certificate no.',
        photoHint: 'Commissioning and sampling',
      },
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 033 */
  mk({
    code: '033',
    title: 'Stormwater Filtration Device',
    group: G,
    scope:
      'Stormwater quality improvement devices — gross pollutant traps, cartridge filters and bio-filtration units, including installation and commissioning to the WSUD design.',
    standards: ['AS/NZS 3500.3:2021', 'Council / WSUD approval', 'AS 3996'],
    materials: [
      mat('Filtration device', 'Make, model and treatment capacity to the approved WSUD design'),
      mat('Filter media / cartridges', 'Type, grade and quantity as supplied by the manufacturer'),
      mat('Access covers', 'Load rated covers to AS 3996 for the location, lockable where required'),
      mat('Bypass arrangement', 'High flow bypass sized to the approved design'),
    ],
    items: [
      ...plantCore('stormwater filtration device'),
      {
        installation: 'Check device installation — bedding, levels, orientation, anti-flotation and inlet / outlet invert levels.',
        acceptance: "In accordance with the manufacturer's installation instructions and the approved WSUD design.",
        point: 'H',
        releasedBy: 'Council / Superintendent',
        photoHint: 'Device set in position with inverts',
      },
      {
        installation: 'Verify the treatment capacity and bypass arrangement against the approved WSUD / stormwater quality design.',
        acceptance: 'Treatment train to achieve the pollutant reduction targets stated in the approved design and development approval.',
        point: 'H',
        releasedBy: 'Council / Civil consultant',
        recordLabel: 'Treatment capacity',
        recordUnit: 'L/s',
        photoHint: 'Nameplate and bypass arrangement',
      },
      {
        installation: 'Check installation of filter media / cartridges and internal components.',
        acceptance: "In accordance with the manufacturer's instructions. Media protected from construction sediment until practical completion.",
        point: 'X',
        photoHint: 'Media / cartridges installed',
      },
      {
        installation: 'Confirm the device is protected or isolated during the construction phase and cleaned out before handover.',
        acceptance: 'Device cleaned out, construction sediment removed and media replaced if fouled, prior to handover.',
        point: 'X',
        photoHint: 'Device cleaned out before handover',
      },
      commissioning('stormwater filtration device', "the manufacturer's commissioning procedure and the approved WSUD design"),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 034 */
  mk({
    code: '034',
    title: 'Rainwater Reuse System',
    group: G,
    scope:
      'Rainwater harvesting and reuse — collection, first flush, filtration, storage, pumps, mains top-up with backflow protection, and non-potable identification.',
    standards: ['AS/NZS 3500.1:2021', 'HB 230', 'AS 2845.1', 'AS/NZS 3500.3:2021'],
    materials: [
      mat('Storage tank', 'Capacity, material and AS/NZS 4020 compliance as specified'),
      mat('Pump set', 'Pressure pump / duty-standby set to the approved schedule'),
      mat('Filtration', 'First flush diverter, leaf screens and filtration to the approved design'),
      mat('Mains top-up', 'Air gap or registered backflow prevention device to AS 2845.1'),
      mat('Identification', 'Lilac (Wisteria) identification and "NON-POTABLE" signage throughout'),
    ],
    items: [
      ...plantCore('rainwater reuse system'),
      {
        installation: 'Check tank installation — base, restraint, overflow, inlet screening, vermin and mosquito proofing and access.',
        acceptance:
          'In accordance with the approved drawings and HB 230. All openings screened, overflow discharging to the stormwater system without backflow.',
        point: 'X',
        photoHint: 'Tank inlet screening and overflow',
      },
      {
        installation: 'Check first flush diverter and pre-filtration installation and sizing.',
        acceptance: "In accordance with the approved design and the manufacturer's instructions.",
        point: 'X',
        photoHint: 'First flush diverter installed',
      },
      {
        installation:
          'Check the mains water top-up arrangement — air gap or registered backflow prevention device — and confirm the top-up cannot contaminate the potable supply.',
        acceptance:
          "In accordance with AS/NZS 3500.1:2021 Section 4 'Cross-connection Control' and AS 2845.1. Device registered and commissioned by an accredited tester.",
        point: 'H',
        releasedBy: 'Water authority / Superintendent',
        recordLabel: 'Device serial no.',
        photoHint: 'Air gap / backflow device at the top-up',
      },
      backflow(),
      {
        installation:
          'Carry out and document a full cross-connection check between the rainwater and potable systems, including all outlets served.',
        acceptance: 'No cross-connection found. Test certificate provided to the water authority.',
        point: 'H',
        releasedBy: 'Water authority / Superintendent',
        recordLabel: 'Cross-connection test ref.',
        photoHint: 'Cross-connection test and certificate',
      },
      electricalInterface(),
      identification('rainwater reuse system', 'Lilac (Wisteria) with "RAINWATER — DO NOT DRINK"'),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      commissioning('rainwater reuse system', "HB 230, the approved design and the manufacturer's commissioning procedure"),
      {
        installation: 'Prove pump operation, tank level control, automatic mains changeover and low level protection.',
        acceptance: 'All modes proven, including changeover to mains on low tank level and return to rainwater on refill.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Changeover test with control indications',
      },
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 035 */
  mk({
    code: '035',
    title: 'Potable Water Pumps',
    group: G,
    scope:
      'Potable cold water pressure boosting — pump sets, pressure vessels, controls, suction arrangement and commissioning to the design duty.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 4020', 'AS/NZS 3000'],
    materials: [
      mat('Pump set', 'Variable speed / fixed speed booster set, duty and head to the approved schedule'),
      mat('Pressure vessel', 'Bladder type vessel, AS/NZS 4020 compliant, pre-charge as specified'),
      mat('Wetted components', 'All wetted components certified to AS/NZS 4020'),
      mat('Valves and strainers', 'Isolation, non-return and strainers with access for servicing'),
      mat('Controls', 'Pump controller with duty rotation, dry run protection and BMS interface'),
    ],
    items: [
      ...plantCore('potable water pump set'),
      {
        installation: 'Check suction arrangement — tank connection, suction head, strainers and provision to prevent air entrainment.',
        acceptance: 'In accordance with the approved design and the manufacturer’s NPSH requirements.',
        point: 'X',
        photoHint: 'Suction manifold and strainer',
      },
      {
        installation: 'Check pressure vessel installation, pre-charge pressure and AS/NZS 4020 compliance.',
        acceptance: "Pre-charge set as per the manufacturer's requirements for the system set point. Vessel certified to AS/NZS 4020.",
        point: 'X',
        recordLabel: 'Vessel pre-charge',
        recordUnit: 'kPa',
        photoHint: 'Vessel with pre-charge gauge reading',
      },
      vibrationNoise(),
      electricalInterface(),
      insulation(),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      flushing(),
      disinfection(),
      {
        installation:
          'Commission the pump set — set the duty point, prove duty rotation, dry run protection, staging and BMS alarms. Record flow and pressure at the design duty.',
        acceptance:
          'Performance to meet the scheduled duty. All protection and alarms proven. Commissioning sheet completed and signed.',
        point: 'H',
        releasedBy: 'Superintendent / Hydraulic consultant',
        recordLabel: 'Duty flow / head',
        recordUnit: 'L/s @ kPa',
        photoHint: 'Controller display at design duty',
      },
      valveOperation(),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 036 */
  mk({
    code: '036',
    title: 'Fire Hose Reel',
    group: G,
    scope: 'Fire hose reel installation — location, coverage, water supply, flow and pressure verification and signage.',
    standards: ['AS 2441:2005', 'AS 2419.1:2021', 'AS 1851:2012', 'NCC Part E1.4'],
    materials: [
      mat('Hose reels', 'Fire hose reels to AS/NZS 1221 with 36 m hose unless otherwise specified'),
      mat('Water supply pipework', 'Sized to deliver the required flow and pressure at the most disadvantaged reel'),
      mat('Isolation', 'Isolation valve to each reel, locked open where required'),
      mat('Signage', 'Fire hose reel signage to AS 2441 / AS 1319'),
    ],
    items: [
      drawingRevision(),
      {
        installation: 'Check hose reel locations and coverage — every part of the floor reachable, exits and travel distances.',
        acceptance: 'In accordance with AS 2441:2005, NCC Part E1.4 and the fire engineering report. Coverage verified on site.',
        point: 'H',
        releasedBy: 'Fire engineer / Building surveyor',
        photoHint: 'Reel position with coverage radius marked',
      },
      materialCompliance('Hose reels to AS/NZS 1221 — confirm hose length and nozzle type'),
      {
        installation: 'Check mounting height, orientation, swing clearance and that the reel does not obstruct an exit path.',
        acceptance: 'In accordance with AS 2441:2005. Reel operable by one person and clear of the required exit width.',
        point: 'X',
        recordLabel: 'Mounting height',
        recordUnit: 'mm',
        photoHint: 'Mounted reel with measured height and swing clearance',
      },
      {
        installation: 'Check water supply connection, isolation valve and non-return / backflow protection where required.',
        acceptance: 'In accordance with AS 2441:2005 and AS/NZS 3500.1:2021 Section 4 for cross-connection control.',
        point: 'X',
        photoHint: 'Supply connection and isolation valve',
      },
      pressureTest(1500, 30, "AS 2441:2005 and AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      {
        installation:
          'Flow and pressure test at the hydraulically most disadvantaged hose reel with the nozzle fully open.',
        acceptance:
          'Not less than 0.33 L/s at the nozzle with a minimum running pressure of 220 kPa at the most disadvantaged reel, in accordance with AS 2441:2005.',
        point: 'H',
        releasedBy: 'Fire services certifier',
        recordLabel: 'Flow / pressure',
        recordUnit: 'L/s @ kPa',
        photoHint: 'Flow measurement at the nozzle with gauge',
      },
      {
        installation: 'Install signage and record the installation on the AS 1851 baseline data sheet.',
        acceptance: 'Signage to AS 2441 / AS 1319. Baseline data recorded for ongoing AS 1851 servicing.',
        point: 'X',
        photoHint: 'Signage and completed baseline data sheet',
      },
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 037 */
  mk({
    code: '037',
    title: 'Fire Hydrant Pumps and System',
    group: G,
    scope:
      'Fire hydrant pumpset and associated system — pump room, diesel / electric pumpsets, controls, fuel, ventilation and full flow commissioning.',
    standards: ['AS 2419.1:2021', 'AS 2941:2013', 'AS 1851:2012', 'AS/NZS 3000'],
    materials: [
      mat('Pumpset', 'Fire pumpset to AS 2941, duty and head to the approved hydraulic design'),
      mat('Controllers', 'Fire pump controllers to AS 2941 with the required monitoring and indication'),
      mat('Fuel system (diesel)', 'Day tank, capacity and bunding to AS 2941 and AS 1940'),
      mat('Test line', 'Flow metering / test line arrangement to AS 2941'),
      mat('Signage and monitoring', 'Signage to AS 2419.1 and monitoring to the fire indicator panel'),
    ],
    items: [
      ...plantCore('fire hydrant pumpset'),
      {
        installation:
          'Check the pump room — fire separation, ventilation, drainage, lighting, access and clearances around the pumpset.',
        acceptance: 'In accordance with AS 2941:2013, the NCC fire separation requirements and the approved drawings.',
        point: 'H',
        releasedBy: 'Fire engineer / Building surveyor',
        photoHint: 'Pump room showing ventilation, drainage and clearances',
      },
      {
        installation: 'Check suction arrangement — tank connection, suction pipework sizing, strainers, vortex inhibitor and flooded suction.',
        acceptance: 'In accordance with AS 2941:2013. Flooded suction maintained at the lowest tank level.',
        point: 'X',
        photoHint: 'Suction pipework and vortex inhibitor',
      },
      {
        installation: 'Check the diesel fuel system — day tank capacity, bunding, fuel lines, and the required run time at full load.',
        acceptance: 'Fuel capacity to provide the run time required by AS 2941:2013 and the fire engineering report. Bunding to AS 1940.',
        point: 'X',
        recordLabel: 'Fuel run time',
        recordUnit: 'hours',
        photoHint: 'Day tank with capacity marking and bunding',
      },
      {
        installation: 'Check the pump controllers, batteries, automatic start arrangement, monitoring and indication to the fire indicator panel.',
        acceptance: 'In accordance with AS 2941:2013 and AS 2419.1:2021. All monitored signals proven to the FIP.',
        point: 'W',
        releasedBy: 'Fire services certifier',
        photoHint: 'Controllers and FIP indications',
      },
      electricalInterface(),
      vibrationNoise(),
      {
        installation: 'Hydrostatically test the pump room pipework.',
        acceptance:
          'Test pressure of 1700 kPa, or 500 kPa above the maximum system pressure where greater, held for the period required by AS 2419.1:2021, with no loss.',
        point: 'H',
        releasedBy: 'Fire services certifier',
        recordLabel: 'Test pressure held',
        recordUnit: 'kPa',
        photoHint: 'Gauge at start and end of the test',
      },
      {
        installation:
          'Full flow commissioning — verify the pumpset performance curve against the scheduled duty, prove automatic start, changeover, run-on and failure modes.',
        acceptance:
          'Performance verified against the AS 2941 test curve and the hydraulic design. All start and failure modes proven. Results recorded on the AS 1851 baseline data sheet.',
        point: 'H',
        releasedBy: 'Fire engineer / Certifier',
        recordLabel: 'Flow / pressure at duty',
        recordUnit: 'L/s @ kPa',
        photoHint: 'Flow test with metered readings and pump curve',
      },
      identification('fire hydrant system', 'Signal red to AS 2700 with AS 2419.1 signage'),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 038 */
  mk({
    code: '038',
    title: 'Hot Water Plant',
    group: G,
    scope:
      'Central heated water plant — heaters / heat pumps, storage, circulation pumps, tempering, expansion and relief, and Legionella control commissioning.',
    standards: ['AS/NZS 3500.4:2021', 'AS/NZS 3666.1', 'AS 1056', 'AS/NZS 5601.1:2022', 'NCC Section J'],
    materials: [
      mat('Water heaters', 'Type, capacity and recovery to the approved schedule, WaterMark certified'),
      mat('Storage vessels', 'Capacity and insulation to the approved schedule'),
      mat('Circulation pumps', 'Duty / standby circulators with bronze or stainless wetted parts'),
      mat('Tempering / TMV', 'Valves to AS 4032.2 / AS 4032.3'),
      mat('Relief and expansion', 'Temperature / pressure relief and expansion control with safe discharge'),
    ],
    items: [
      ...plantCore('hot water plant'),
      {
        installation: 'Check the plant room arrangement — access, clearances for tube / element withdrawal, drainage and floor waste.',
        acceptance: "In accordance with the manufacturer's clearance requirements and the approved drawings.",
        point: 'X',
        photoHint: 'Plant layout with maintenance clearances',
      },
      {
        installation:
          'Check temperature and pressure relief valves, expansion control and the relief drain lines, including discharge terminations.',
        acceptance:
          "In accordance with AS/NZS 3500.4:2021 and the manufacturer's instructions. Relief lines full bore, continuously falling, discharging to a safe and visible location.",
        point: 'H',
        releasedBy: 'Superintendent',
        photoHint: 'Relief valves and discharge terminations',
      },
      {
        installation: 'Check circulation pumps, balancing, non-return valves and the return arrangement to each heater / storage vessel.',
        acceptance: 'In accordance with the approved drawings. Circulation proven to all branches on commissioning.',
        point: 'X',
        photoHint: 'Circulation pump set and balancing valves',
      },
      {
        installation: 'Check tempering / TMV set, isolation, strainers, servicing access and labelling.',
        acceptance: "In accordance with AS/NZS 3500.4:2021 and the manufacturer's instructions.",
        point: 'X',
        photoHint: 'TMV set with labels and isolation',
      },
      {
        installation: 'Check gas connection, flue, ventilation and appliance clearances for gas fired plant.',
        acceptance: 'In accordance with AS/NZS 5601.1:2022 and the appliance manufacturer’s installation instructions.',
        point: 'X',
        photoHint: 'Flue and ventilation arrangement',
      },
      electricalInterface(),
      insulation(),
      pressureTest(1500, 30, "AS/NZS 3500.4:2021 and AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      flushing(),
      disinfection(),
      {
        installation:
          'Commission the plant and record storage, circulation return and delivery temperatures; prove the system meets the Legionella control requirements.',
        acceptance:
          'Stored water at 60 °C or greater and circulated return not below 60 °C in accordance with AS/NZS 3666.1. Delivery temperature at ablution fixtures not exceeding 45 °C (50 °C elsewhere) per AS/NZS 3500.4:2021.',
        point: 'H',
        releasedBy: 'Superintendent / Building certifier',
        recordLabel: 'Stored / return / delivery temp.',
        recordUnit: '°C',
        photoHint: 'Temperature readings at storage, return and outlet',
      },
      valveOperation(),
      identification('heated water plant', 'Red-brown / "HOT WATER" with flow and return marked'),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 039 */
  mk({
    code: '039',
    title: 'Reverse Osmosis Plant',
    group: G,
    scope:
      'Reverse osmosis / water treatment plant — pre-treatment, membranes, storage, distribution, drain connections and water quality commissioning.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 4020', 'AS/NZS 3000', 'Manufacturer specification'],
    materials: [
      mat('RO plant', 'Make, model, output and recovery rate to the approved technical submission'),
      mat('Pre-treatment', 'Sediment, carbon and softening stages as specified'),
      mat('Membranes', 'Type and quantity as supplied by the manufacturer, within shelf life'),
      mat('Distribution pipework', 'Material compatible with treated water (no leaching), AS/NZS 4020 where applicable'),
      mat('Drain / reject', 'Reject water connection with an air break to the drainage system'),
    ],
    items: [
      ...plantCore('reverse osmosis plant'),
      {
        installation: 'Check feed water supply, isolation, pressure and pre-treatment stages against the design feed water quality.',
        acceptance:
          "In accordance with the manufacturer's feed water requirements and the approved design. Feed water analysis on file.",
        point: 'X',
        recordLabel: 'Feed water TDS',
        recordUnit: 'ppm',
        photoHint: 'Pre-treatment train and feed connection',
      },
      {
        installation: 'Check membrane installation, orientation and pressure vessel assembly.',
        acceptance: "In accordance with the manufacturer's installation procedure. Membranes within shelf life and undamaged.",
        point: 'X',
        photoHint: 'Membrane vessels with labels',
      },
      {
        installation: 'Check the reject / drain connection is via an air break, and that the reject rate is as designed.',
        acceptance:
          "Air break in accordance with AS/NZS 3500.1:2021 Section 4 'Cross-connection Control'. Reject rate as per the approved design.",
        point: 'H',
        releasedBy: 'Superintendent / Water authority',
        photoHint: 'Air break at the reject connection',
      },
      backflow(),
      {
        installation: 'Check treated water storage, distribution material compatibility, recirculation and sanitisation provisions.',
        acceptance: 'Materials compatible with treated (aggressive) water. Recirculation and sanitisation as per the approved design.',
        point: 'X',
        photoHint: 'Treated water storage and distribution',
      },
      electricalInterface(),
      pressureTest(1500, 30, "AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning'"),
      flushing(),
      {
        installation:
          'Commission the RO plant — flush the membranes, set the operating pressures, and record permeate quality, recovery rate and output.',
        acceptance:
          "Permeate quality, recovery rate and output to meet the approved design and the manufacturer's specification. Commissioning report provided.",
        point: 'H',
        releasedBy: 'Superintendent / End user',
        recordLabel: 'Permeate conductivity',
        recordUnit: 'µS/cm',
        photoHint: 'Plant display showing permeate quality and output',
      },
      identification('treated water', 'As required by AS 1345 with "RO / TREATED WATER"'),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 040 */
  mk({
    code: '040',
    title: 'Potable Cold Water Tank',
    group: G,
    scope:
      'Potable cold water storage tank — construction, AS/NZS 4020 compliance, inlet / outlet arrangement, overflow, screening, access and disinfection.',
    standards: ['AS/NZS 3500.1:2021', 'AS/NZS 4020', 'AS 1657', 'AS/NZS 3666.1'],
    materials: [
      mat('Tank', 'Capacity, material and lining certified to AS/NZS 4020 for potable water contact'),
      mat('Inlet / outlet', 'Inlet arrangement to avoid stagnation, outlet with anti-vortex plate'),
      mat('Overflow and vents', 'Sized to the inlet flow, screened against vermin and insects'),
      mat('Level control', 'Float / solenoid inlet control with high and low level alarms'),
      mat('Access', 'Lockable, sealed access hatch with ladder and fall protection to AS 1657'),
    ],
    items: [
      ...plantCore('potable cold water tank'),
      {
        installation:
          'Verify the tank, lining and all wetted components are certified to AS/NZS 4020 for contact with drinking water.',
        acceptance: 'AS/NZS 4020 certification provided for the tank, lining, fittings and gaskets. No non-compliant materials in contact with the stored water.',
        point: 'H',
        releasedBy: 'Superintendent / Hydraulic consultant',
        recordLabel: 'AS/NZS 4020 certificate ref.',
        photoHint: 'Certification documentation and tank labelling',
      },
      {
        installation: 'Check tank base, structural support, restraint and drainage around the tank; confirm the base is level and fully supported.',
        acceptance: "In accordance with the structural drawings and the tank manufacturer's requirements.",
        point: 'X',
        photoHint: 'Tank base and support',
      },
      {
        installation:
          'Check inlet and outlet positions to promote turnover and avoid stagnation, including an anti-vortex plate at the outlet.',
        acceptance:
          'In accordance with the approved design and AS/NZS 3666.1 for stored water turnover. Outlet drawn from the opposite end to the inlet.',
        point: 'X',
        photoHint: 'Inlet and outlet arrangement inside the tank',
      },
      {
        installation:
          'Check overflow, warning pipe, vents and all openings are screened and sealed against vermin, insects, light and contamination.',
        acceptance:
          'In accordance with AS/NZS 3500.1:2021 and AS/NZS 3666.1. Overflow sized to the maximum inlet flow and discharging to a visible location.',
        point: 'X',
        photoHint: 'Screened overflow and vents',
      },
      {
        installation: 'Check the inlet control and level alarms, including the high level / overflow alarm to the BMS.',
        acceptance: 'Inlet control set to the design levels. High and low level alarms proven.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Level control and alarm indications',
      },
      {
        installation: 'Check access hatch, ladder, platform, handrails and fall protection.',
        acceptance: 'In accordance with AS 1657. Hatch lockable and sealed. Safe access for cleaning and inspection.',
        point: 'X',
        photoHint: 'Access hatch and ladder arrangement',
      },
      {
        installation: 'Fill and water test the tank for leakage and structural performance.',
        acceptance: 'No leakage or deformation after 24 hours at full capacity.',
        point: 'W',
        releasedBy: 'Superintendent',
        recordLabel: 'Test duration',
        recordUnit: 'hours',
        photoHint: 'Tank filled to overflow level',
      },
      disinfection(),
      identification('potable water tank', 'Blue / "POTABLE WATER" with capacity marked'),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 041 */
  mk({
    code: '041',
    title: 'Fire System Water Tank',
    group: G,
    scope:
      'Dedicated fire system water storage — capacity verification, connections, reserve protection, level monitoring and access.',
    standards: ['AS 2304:2019', 'AS 2419.1:2021', 'AS 2118.1:2017', 'AS 1657'],
    materials: [
      mat('Tank', 'Fire water storage tank to AS 2304, capacity to the approved fire engineering design'),
      mat('Connections', 'Fire pump suction, top-up inlet and overflow to AS 2304'),
      mat('Reserve protection', 'Arrangement preventing the fire reserve being drawn by other services'),
      mat('Level monitoring', 'Low level alarm monitored at the fire indicator panel'),
      mat('Access', 'Access hatch, ladder and fall protection to AS 1657'),
    ],
    items: [
      ...plantCore('fire system water tank'),
      {
        installation:
          'Verify the effective fire reserve capacity against the fire engineering report and the hydraulic design, measured between the outlet and the low water level.',
        acceptance:
          'Effective capacity to meet AS 2304:2019 and the fire engineering report for the required system duration. Capacity confirmed by measurement or manufacturer certification.',
        point: 'H',
        releasedBy: 'Fire engineer / Certifier',
        recordLabel: 'Effective fire reserve',
        recordUnit: 'L',
        photoHint: 'Tank with capacity plate and outlet level',
      },
      {
        installation: 'Check tank base, structural support, restraint and separation / fire rating requirements.',
        acceptance: "In accordance with AS 2304:2019, the structural drawings and the manufacturer's requirements.",
        point: 'X',
        photoHint: 'Tank base and support arrangement',
      },
      {
        installation:
          'Check the fire pump suction connection, anti-vortex plate, and that any shared or non-fire connection cannot draw down the fire reserve.',
        acceptance:
          'In accordance with AS 2304:2019 and AS 2419.1:2021. Non-fire draw-off taken above the fire reserve level, or a separate reserve maintained.',
        point: 'H',
        releasedBy: 'Fire engineer / Certifier',
        photoHint: 'Suction connection and reserve protection arrangement',
      },
      {
        installation: 'Check the automatic top-up arrangement, backflow protection and refill rate.',
        acceptance:
          "Refill rate to restore the reserve within the period required by AS 2304:2019. Backflow protection in accordance with AS/NZS 3500.1:2021 Section 4.",
        point: 'X',
        recordLabel: 'Refill rate',
        recordUnit: 'L/s',
        photoHint: 'Top-up inlet with backflow device',
      },
      {
        installation: 'Check overflow, vents, screening and access hatch, ladder and fall protection.',
        acceptance: 'In accordance with AS 2304:2019 and AS 1657. All openings screened and the hatch lockable.',
        point: 'X',
        photoHint: 'Overflow, vents and access arrangement',
      },
      {
        installation: 'Commission the low water level alarm and prove the signal at the fire indicator panel.',
        acceptance: 'Low level alarm proven at the FIP in accordance with AS 2304:2019 and AS 1851:2012.',
        point: 'H',
        releasedBy: 'Fire services certifier',
        photoHint: 'Alarm test with FIP indication',
      },
      {
        installation: 'Fill and water test the tank for leakage and structural performance.',
        acceptance: 'No leakage or deformation after 24 hours at full capacity.',
        point: 'W',
        releasedBy: 'Superintendent',
        recordLabel: 'Test duration',
        recordUnit: 'hours',
        photoHint: 'Tank filled to the overflow level',
      },
      identification('fire system water tank', 'Signal red to AS 2700 with "FIRE SERVICE WATER — RESERVE" and capacity marked'),
      handover(),
      defectsCheck(),
    ],
  }),

  /* ------------------------------------------------------------------ 042 */
  mk({
    code: '042',
    title: 'Non Potable Water Tank',
    group: G,
    scope:
      'Non-potable (recycled, rainwater or bore) water storage tank — construction, identification, cross-connection control, screening and access.',
    standards: ['AS/NZS 3500.1:2021', 'HB 230', 'AS 2845.1', 'AS 1657'],
    materials: [
      mat('Tank', 'Capacity and material to the approved design, UV stable and light-proof'),
      mat('Identification', 'Lilac (Wisteria) identification and "NON-POTABLE — DO NOT DRINK" signage'),
      mat('Mains top-up', 'Air gap or registered backflow prevention device to AS 2845.1'),
      mat('Screening', 'Insect and vermin proof screening to all inlets, vents and overflows'),
      mat('Access', 'Lockable access hatch, ladder and fall protection to AS 1657'),
    ],
    items: [
      ...plantCore('non-potable water tank'),
      {
        installation: 'Check tank base, structural support, restraint and drainage around the tank.',
        acceptance: "In accordance with the structural drawings and the tank manufacturer's requirements.",
        point: 'X',
        photoHint: 'Tank base and support',
      },
      {
        installation:
          'Check the mains top-up arrangement — air gap or registered backflow device — and confirm the potable supply cannot be contaminated.',
        acceptance:
          "In accordance with AS/NZS 3500.1:2021 Section 4 'Cross-connection Control' and AS 2845.1. Device registered and commissioned by an accredited tester.",
        point: 'H',
        releasedBy: 'Water authority / Superintendent',
        recordLabel: 'Device serial no.',
        photoHint: 'Air gap / backflow device at the top-up',
      },
      {
        installation:
          'Check overflow, warning pipe, vents and all openings are screened against vermin, insects and light ingress (algae control).',
        acceptance: 'In accordance with AS/NZS 3500.1:2021 and HB 230. Overflow sized to the maximum inlet flow.',
        point: 'X',
        photoHint: 'Screened overflow and vents',
      },
      {
        installation: 'Check outlet arrangement, low level protection for the pump and any first flush / sediment provisions.',
        acceptance: 'In accordance with the approved design. Outlet raised clear of accumulated sediment.',
        point: 'X',
        photoHint: 'Outlet and low level arrangement',
      },
      {
        installation: 'Check level monitoring, alarms and any automatic changeover to the mains supply.',
        acceptance: 'Alarms and changeover proven as per the approved control philosophy.',
        point: 'W',
        releasedBy: 'Superintendent',
        photoHint: 'Level control and changeover indication',
      },
      {
        installation: 'Check access hatch, ladder, platform and fall protection.',
        acceptance: 'In accordance with AS 1657. Hatch lockable and sealed.',
        point: 'X',
        photoHint: 'Access hatch and ladder',
      },
      {
        installation: 'Fill and water test the tank for leakage and structural performance.',
        acceptance: 'No leakage or deformation after 24 hours at full capacity.',
        point: 'W',
        releasedBy: 'Superintendent',
        recordLabel: 'Test duration',
        recordUnit: 'hours',
        photoHint: 'Tank filled to overflow level',
      },
      identification('non-potable water tank', 'Lilac (Wisteria) with "NON-POTABLE WATER — DO NOT DRINK" and capacity marked'),
      handover(),
      defectsCheck(),
    ],
  }),
]
