import type { ItpTemplate, TemplateGroup, TemplateItem, TemplateMaterial } from '../types'

/** A schedule row before it has been given its printed item number. */
export type Row = Omit<TemplateItem, 'no'>

export const row = (r: Row): Row => r

/**
 * Builds a template, numbering the schedule 1.0, 2.0, 3.0 … in the same style
 * as the paper form.
 */
export function mk(args: {
  code: string
  title: string
  group: TemplateGroup
  scope: string
  standards: string[]
  materials: TemplateMaterial[]
  items: Row[]
}): ItpTemplate {
  return {
    code: args.code,
    title: args.title,
    group: args.group,
    scope: args.scope,
    standards: args.standards,
    materials: args.materials,
    items: args.items.map((r, i) => ({ ...r, no: `${i + 1}.0` })),
  }
}

export const mat = (item: string, requirement: string): TemplateMaterial => ({ item, requirement })

/* ------------------------------------------------------------------------
   Frequently reused schedule rows. Each returns a fresh object so callers can
   spread over it to tune the point type or wording for a particular service.
   ------------------------------------------------------------------------ */

export const drawingRevision = (): Row => ({
  installation: 'Check current revision of drawings issued for construction, including any RFI or site instruction affecting this area.',
  acceptance: 'In accordance with the project Drawing Register. Superseded revisions removed from site.',
  point: 'X',
  photoHint: 'Title block showing drawing number and revision',
})

export const setOut = (service: string, std: string): Row => ({
  installation: `Set out ${service} route and check before excavation. Identify all existing services (Dial Before You Dig, service locator, potholing). Ensure all set out equipment is within current calibration.`,
  acceptance: `In accordance with ${std} and the hydraulic specification. Set out to agree with coordinated shop drawings and survey control.`,
  point: 'X',
  photoHint: 'Marked out route and service locate markings',
})

export const excavation = (): Row => ({
  installation:
    'Check depth of excavation prior to entering trench. Benching, battering or trench support provided where depth exceeds 1500 mm.',
  acceptance:
    "In accordance with AS/NZS 3500.2:2021 Section 5 'Excavation, Bedding and Support', SWMS and the hydraulic specification.",
  point: 'X',
  recordLabel: 'Excavation depth',
  recordUnit: 'mm',
  photoHint: 'Open trench showing depth and support',
})

export const trenchBase = (): Row => ({
  installation:
    'Check base of trench is free from sharp material and rock, and that the trench base is 100 mm deeper than the required invert to allow for pipe bedding.',
  acceptance:
    "In accordance with AS/NZS 3500.2:2021 Section 5.4 'Bedding of Drains' and the hydraulic specification.",
  point: 'X',
  photoHint: 'Trench base prior to bedding',
})

export const bedding = (): Row => ({
  installation: 'Bedding of trench using PM 64 quarry sand to a minimum of 100 mm thick, evenly graded and compacted.',
  acceptance:
    "In accordance with AS/NZS 3500.2:2021 Section 5.4 'Bedding of Drains' and the hydraulic specification.",
  point: 'X',
  recordLabel: 'Bedding thickness',
  recordUnit: 'mm',
  photoHint: 'Bedding placed in trench',
})

export const materialCompliance = (options: string): Row => ({
  installation: `Check materials delivered to site for compliance and damage (${options}). Record batch / lot numbers and WaterMark or certification details.`,
  acceptance:
    "In accordance with AS/NZS 3500.2:2021 Section 2.3 'Selection and Use of Materials and Products', WaterMark certification and the hydraulic specification.",
  point: 'X',
  photoHint: 'Product markings, batch numbers and certification labels',
})

export const layAtGrade = (): Row => ({
  installation:
    'Install pipework at approved grades as per AS/NZS 3500 and approved hydraulic shop drawings. Check all invert levels against the coordinated hydraulic shop drawings.',
  acceptance:
    "In accordance with AS/NZS 3500.2:2021 Section 3.4 'Grades of Drains' and the hydraulic specification.",
  point: 'X',
  recordLabel: 'Grade achieved',
  recordUnit: '%',
  photoHint: 'Laser level / dumpy readings and laid pipework',
})

export const checkDims = (): Row => ({
  installation: 'Check pipe dimensions, pipe grade and invert levels prior to backfill.',
  acceptance:
    "To suit current design drawings and in accordance with AS/NZS 3500.2:2021 Section 3.4 'Grades of Drains' requirements.",
  point: 'X',
  recordLabel: 'Invert level',
  recordUnit: 'm AHD',
  photoHint: 'Level staff / invert measurement',
})

export const turnUps = (): Row => ({
  installation: 'Check positioning of turn ups, risers, inspection openings and future connection points.',
  acceptance: 'In accordance with the approved hydraulic shop drawings and architectural set out.',
  point: 'X',
  photoHint: 'Turn ups with dimensions to grid or structure',
})

export const backfill = (): Row => ({
  installation:
    'Backfill using "best of excavated material" or PM64 sand to underside of quarry rubble base. Install base quarry rubble minimum 100 mm thick PM 2/20. Backfill material placed in 200 mm layers compacted to 95% Modified Maximum Dry Density (MMDD). Compaction test every 20 m.',
  acceptance:
    "In accordance with AS/NZS 3500.2:2021 Section 5.5 'Installation of Backfill Materials' and the hydraulic specification. Compaction test results to be provided.",
  point: 'X',
  recordLabel: 'Compaction result',
  recordUnit: '% MMDD',
  photoHint: 'Backfill layers and compaction plant',
})

export const markerTape = (service: string, colour: string): Row => ({
  installation: `Install detectable marker tape and tracer wire over the ${service}, 300 mm above the crown of the pipe.`,
  acceptance: `${colour} marker tape in accordance with AS 2648.1 and the hydraulic specification. Tracer wire continuous and terminated for future location.`,
  point: 'X',
  photoHint: 'Marker tape laid over pipework in trench',
})

export const hydrostaticTest = (opts?: { minutes?: number; point?: 'W' | 'H' | 'X' | 'S'; std?: string }): Row => ({
  installation: `Hydrostatic test with water to finished ground level, minimum test duration of ${opts?.minutes ?? 15} minutes.`,
  acceptance: `${opts?.minutes ?? 15} minutes or greater with no loss of water, in accordance with ${
    opts?.std ?? "AS/NZS 3500.2:2021 Section 15 'Testing'"
  }.`,
  point: opts?.point ?? 'W',
  releasedBy: 'Superintendent / Head contractor',
  recordLabel: 'Test duration held',
  recordUnit: 'minutes',
  photoHint: 'Filled system, test head and gauge showing no loss',
})

export const airTest = (kpa = 30, minutes = 15): Row => ({
  installation: `Air test the installed section, pressurised and stabilised prior to timing the test.`,
  acceptance: `Test pressure of ${kpa} kPa held for a minimum of ${minutes} minutes with no measurable loss, in accordance with AS/NZS 3500.2:2021 Section 15 'Testing' and the hydraulic specification.`,
  point: 'W',
  releasedBy: 'Superintendent / Head contractor',
  recordLabel: 'Test pressure held',
  recordUnit: 'kPa',
  photoHint: 'Gauge reading at start and end of the test period',
})

export const pressureTest = (kpa: number, minutes: number, std: string): Row => ({
  installation: `Hydrostatic pressure test of the completed section to ${kpa} kPa (or 1.5 × maximum working pressure, whichever is the greater) held for ${minutes} minutes.`,
  acceptance: `No loss of pressure and no visible leakage over ${minutes} minutes, in accordance with ${std} and the hydraulic specification.`,
  point: 'W',
  releasedBy: 'Superintendent / Head contractor',
  recordLabel: 'Test pressure held',
  recordUnit: 'kPa',
  photoHint: 'Calibrated gauge showing test pressure, with test board',
})

export const authorityInspection = (authority: string): Row => ({
  installation: `${authority} inspection of the installed works prior to covering.`,
  acceptance: `Inspection booked by 3:00 pm the day before the inspection is required. Works not to be covered until released. Record the inspection / consent number.`,
  point: 'H',
  releasedBy: authority,
  recordLabel: 'Inspection / consent no.',
  photoHint: 'Inspection notice or approval card',
})

export const sealOpenEnds = (): Row => ({
  installation: 'Seal test gates and cap all open ends on completion of the section.',
  acceptance: 'Dust caps and temporary seals fitted to all open ends to prevent ingress of debris.',
  point: 'X',
  photoHint: 'Capped open ends',
})

export const flushing = (): Row => ({
  installation: 'Flush pipework on completion of that section and confirm free discharge.',
  acceptance: 'In accordance with the hydraulic specification. No debris, free flow observed at the downstream point.',
  point: 'X',
  photoHint: 'Flushing in progress / clean discharge',
})

export const asBuilt = (): Row => ({
  installation: 'Record as-installed dimensions, invert levels and deviations for the as-built / work-as-executed drawings.',
  acceptance: 'Marked-up drawings and survey pick-up submitted to the design team prior to covering.',
  point: 'X',
  photoHint: 'Marked-up drawing extract for this area',
})

export const bracketing = (std: string): Row => ({
  installation: 'Check pipe support, bracketing and fixing centres, including provision for thermal movement and seismic restraint where specified.',
  acceptance: `In accordance with ${std}, manufacturer's requirements and the hydraulic specification. Fixings suitable for the substrate.`,
  point: 'X',
  photoHint: 'Typical bracket and fixing centres',
})

export const penetrations = (): Row => ({
  installation: 'Check penetrations through fire and acoustic rated elements are sealed with a tested and approved system.',
  acceptance:
    'Fire collars / wraps installed in accordance with AS 4072.1 and the tested system, matching the FRL of the element penetrated. Acoustic seals in accordance with the acoustic report.',
  point: 'S',
  releasedBy: 'Fire engineer / Building surveyor',
  photoHint: 'Installed collar with product label visible',
})

export const identification = (service: string, colour: string): Row => ({
  installation: `Apply pipe identification and directional flow markings to the ${service}.`,
  acceptance: `${colour} identification in accordance with AS 1345 and AS 2700, at intervals and locations required by the hydraulic specification.`,
  point: 'X',
  photoHint: 'Applied pipe labels and flow arrows',
})

export const insulation = (): Row => ({
  installation: 'Check pipe insulation type, thickness and vapour sealing, including at supports and valves.',
  acceptance:
    'In accordance with NCC Section J and the hydraulic specification. Continuous, unbroken vapour barrier with no compression at supports.',
  point: 'X',
  photoHint: 'Insulated pipework including a support detail',
})

export const valveOperation = (): Row => ({
  installation: 'Operate and label all isolation valves; confirm access, orientation and zone of control.',
  acceptance: 'Valves accessible and operable, labelled to the valve schedule, and shown on the valve chart.',
  point: 'X',
  photoHint: 'Valve with identification label / valve chart',
})

export const commissioning = (system: string, std: string): Row => ({
  installation: `Commission the ${system} and record all commissioning results.`,
  acceptance: `In accordance with ${std}, the manufacturer's commissioning procedure and the hydraulic specification. Commissioning sheets signed and submitted.`,
  point: 'W',
  releasedBy: 'Superintendent / Head contractor',
  photoHint: 'Commissioning readings and completed data sheet',
})

export const handover = (): Row => ({
  installation:
    'Provide operation and maintenance manuals, warranties, as-built drawings, test certificates and demonstrate operation to the client.',
  acceptance: 'In accordance with the contract handover requirements. Training record signed by the client representative.',
  point: 'H',
  releasedBy: 'Superintendent',
  photoHint: 'Handover documentation / training attendance record',
})

export const defectsCheck = (): Row => ({
  installation: 'Final visual inspection of the completed installation; make good all damage, protective coatings and surrounds.',
  acceptance: 'No visible defects. Area left clean and all protection removed. Defects register updated.',
  point: 'X',
  photoHint: 'Completed installation',
})

export const disinfection = (): Row => ({
  installation:
    'Disinfect the potable water installation and flush. Sample and test for bacteriological compliance before the system is put into service.',
  acceptance:
    "In accordance with AS/NZS 3500.1:2021 Section 16 'Testing and Commissioning' and the water authority requirements. NATA laboratory results to confirm compliance with the Australian Drinking Water Guidelines.",
  point: 'H',
  releasedBy: 'Superintendent / Water authority',
  recordLabel: 'Lab certificate no.',
  photoHint: 'Sampling point and chlorination record',
})

export const backflow = (): Row => ({
  installation:
    'Install and commission backflow prevention device appropriate to the assessed hazard rating. Register the device with the water authority.',
  acceptance:
    "In accordance with AS/NZS 3500.1:2021 Section 4 'Cross-connection Control', AS 2845.1 and the water authority requirements. Commissioning report by an accredited backflow tester.",
  point: 'H',
  releasedBy: 'Water authority / Superintendent',
  recordLabel: 'Device serial no.',
  photoHint: 'Installed device with test report',
})

export const weldJoints = (method: string): Row => ({
  installation: `Check jointing of pipework (${method}). Confirm operator qualification, machine calibration and that joint records are retained.`,
  acceptance:
    "In accordance with AS/NZS 2033 (PE), the pipe manufacturer's jointing procedure and the hydraulic specification. Joint log to be provided.",
  point: 'S',
  releasedBy: 'Superintendent',
  photoHint: 'Completed joint with fusion record / weld bead',
})

export const trenchDepthCover = (cover: string, std: string): Row => ({
  installation: `Confirm minimum cover over the installed main is achieved, including under trafficable areas.`,
  acceptance: `Minimum cover of ${cover} in accordance with ${std} and the hydraulic specification. Additional protection (slab or sleeve) where cover cannot be achieved.`,
  point: 'X',
  recordLabel: 'Cover achieved',
  recordUnit: 'mm',
  photoHint: 'Measured cover over pipe prior to final backfill',
})

export const pitsAndCovers = (): Row => ({
  installation: 'Install pits, inspection openings and covers to correct finished level, class and orientation.',
  acceptance:
    'Covers to the load class nominated in the hydraulic specification (AS 3996), set flush with finished surface levels and marked with the service.',
  point: 'X',
  photoHint: 'Installed pit and cover at finished level',
})
