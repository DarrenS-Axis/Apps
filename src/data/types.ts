/**
 * Domain model for the Axis QA system.
 *
 * Three modules share one project structure, the way the Controldoc reports
 * present them:
 *
 *   Controldoc  Inspection & Test Plans — materials, checklist, test record,
 *               attachments, Axis and client sign-off
 *   Firedoc     the fire-rated penetration register, allocated against the
 *               Passive Fire Rating Schedule and pinned on penetration plans
 *   Reviewdoc   the QA defect register, costed and reported to the head
 *               contractor
 *
 * Above the project sits the business unit — a state office such as
 * "NSW Major Works" — and above that the national roll-up. A person belongs
 * to one state and sees only its projects; the national QA role sees every
 * state's numbers, for reporting.
 */

/**
 * Inspection point key, as printed on every Controldoc ITP:
 * H = Hold Point, M = Monitor / Surveillance, W = Witness,
 * X = Self Inspection by performer of work.
 */
export type PointType = 'H' | 'W' | 'M' | 'X'

export const POINT_TYPES: Record<PointType, { label: string; short: string; cls: string; help: string }> = {
  H: {
    label: 'Hold Point',
    short: 'HOLD',
    cls: 'chip--hold',
    help: 'Work must not proceed past this step until it is released by the nominated party.',
  },
  W: {
    label: 'Witness',
    short: 'WITNESS',
    cls: 'chip--witness',
    help: 'The nominated party is given notice and may attend. Work may proceed if they do not.',
  },
  M: {
    label: 'Monitor / Surveillance',
    short: 'MONITOR',
    cls: 'chip--surv',
    help: 'Monitored by the nominated party on an ongoing or sampled basis.',
  },
  X: {
    label: 'Self Inspection by performer of work',
    short: 'SELF',
    cls: 'chip--self',
    help: 'Inspected and recorded by the person doing the work.',
  },
}

/** Legacy key from the first release, read back as Monitor / Surveillance. */
export const normalisePoint = (p: string): PointType => (p === 'S' ? 'M' : (p as PointType))

export type ItemStatus = 'pending' | 'pass' | 'fail' | 'na'

/**
 * Lifecycle shared by every record in the three modules, using the column
 * headings from the monthly QA report so the numbers here are the numbers
 * there: Setup → In Progress → Completed by Site → Reviewed & Approved, with
 * Defected as the review's other outcome.
 */
export type QaStatus = 'setup' | 'in_progress' | 'completed_by_site' | 'reviewed_approved' | 'defected'

export const QA_STATUS_LABEL: Record<QaStatus, string> = {
  setup: 'Setup',
  in_progress: 'In progress',
  completed_by_site: 'Completed by site',
  reviewed_approved: 'Reviewed & approved',
  defected: 'Defected',
}

export const QA_STATUSES: QaStatus[] = ['setup', 'in_progress', 'completed_by_site', 'reviewed_approved', 'defected']

/** Records still to be finished, per the report's "Outstanding" column. */
export const isOutstanding = (s: QaStatus): boolean => s === 'setup' || s === 'in_progress' || s === 'defected'

export type ItpStatus = QaStatus
export const ITP_STATUS_LABEL = QA_STATUS_LABEL

/* ------------------------------------------------------------ organisation */

/** Australian states and territories Axis operates in. */
export type StateCode = 'NSW' | 'ACT' | 'QLD' | 'VIC' | 'NT' | 'WA' | 'SA' | 'TAS'

export const STATE_NAMES: Record<StateCode, string> = {
  NSW: 'New South Wales',
  ACT: 'Australian Capital Territory',
  QLD: 'Queensland',
  VIC: 'Victoria',
  NT: 'Northern Territory',
  WA: 'Western Australia',
  SA: 'South Australia',
  TAS: 'Tasmania',
}

export const STATE_CODES: StateCode[] = ['NSW', 'ACT', 'QLD', 'VIC', 'NT', 'WA', 'SA', 'TAS']

/**
 * A business unit is the "BUSINESS UNIT (STATE/OFFICE)" column of the QA
 * report — "NSW Major Works", "NSW Med Gas", "QLD". Projects belong to one,
 * and a state can have several.
 */
export interface BusinessUnit {
  id: string
  state: StateCode
  name: string
  /** Trading entity printed on sign-offs, e.g. "Axis Plumbing NSW". */
  entity: string
  office?: string
  phone?: string
  abn?: string
  createdAt: number
  updatedAt: number
}

/**
 * What a person can see. Site and state QA are held to their own state; the
 * national QA role sees every state's projects and numbers, for reporting.
 */
export type UserRole = 'site' | 'state_qa' | 'national_qa'

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  site: 'Site',
  state_qa: 'State QA',
  national_qa: 'National QA',
}

/** Which modules a project runs. Small works often run Controldoc only. */
export interface ProjectModules {
  controldoc: boolean
  firedoc: boolean
  reviewdoc: boolean
}

export type ModuleKey = keyof ProjectModules

export const MODULE_LABEL: Record<ModuleKey, string> = {
  controldoc: 'Controldoc',
  firedoc: 'Firedoc',
  reviewdoc: 'Reviewdoc',
}

/* ---------------------------------------------------------------- project */

export interface Project {
  id: string
  /** Business unit this project reports under. */
  businessUnitId: string
  state: StateCode
  name: string
  /** Client / head contractor the ITPs are issued to. */
  client: string
  projectNumber: string
  address: string
  /** Contractor issuing the ITP — printed top-left on the paper form. */
  contractor: string
  /** Person who approves ITPs for use, e.g. the project manager. */
  approvedBy: string
  approvedByRole: string
  /** Data URL of the contractor logo, drawn top-left on the exported PDF. */
  contractorLogo?: string
  /** Data URL of the client logo, drawn top-right on the exported PDF. */
  clientLogo?: string
  /** Free text printed under the header, e.g. "MINUS 1 - Adelaide". */
  stage: string
  /** Security marking printed in the PDF header/footer, e.g. "OFFICIAL". */
  marking: string
  modules: ProjectModules
  /**
   * Client document-number scheme for ITP references, with `{n}` for the
   * sequence, e.g. "SMCSWSPS-AXP-OSN-BS-ITP-{n}". Blank uses the ITC number.
   */
  locRefScheme?: string
  createdAt: number
  updatedAt: number
  archived?: boolean
}

/* --------------------------------------------------------------- drawings */

export interface Drawing {
  id: string
  projectId: string
  /** Drawing number, e.g. "HC-001". */
  number: string
  title: string
  /** Revision or issue, e.g. "ISSUE 4" or "Rev C". */
  revision: string
  discipline: string
  /** Raster image of the plan (a page render or screenshot) as a data URL. */
  imageData?: string
  imageWidth?: number
  imageHeight?: number
  /** Thumbnail data URL for list views. */
  thumbData?: string
  issuedDate?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ plans */

/** A marker dropped on a drawing to record where an inspection took place. */
export interface PlanPin {
  id: string
  drawingId: string
  /** Normalised 0..1 position on the drawing image. */
  x: number
  y: number
  /** Short label shown inside the pin, usually the ITP item number. */
  label: string
  /** Item number this pin relates to, if any. */
  itemNo?: string
  note?: string
  /** Where the device was when the pin was dropped or last moved. */
  lat?: number
  lng?: number
  accuracy?: number
  locatedAt?: number
  createdAt: number
}

/**
 * A highlighted part of a drawing, marking the extent of work an ITP covers —
 * the equivalent of running a highlighter along the pipe run on a paper plan,
 * or boxing the area, before handing it to the inspector.
 */
export interface PlanRegion {
  id: string
  drawingId: string
  /** `highlight` traces a run; `area` boxes a zone. */
  kind: 'highlight' | 'area'
  /**
   * Normalised 0..1 points on the drawing image. A highlight is the traced
   * path; an area is its two opposite corners.
   */
  points: { x: number; y: number }[]
  colour: RegionColour
  label: string
  /** Schedule item this extent relates to, if any. */
  itemNo?: string
  note?: string
  createdAt: number
}

export type RegionColour = 'yellow' | 'orange' | 'green' | 'blue' | 'pink'

/**
 * Highlighter colours, kept strong enough to read against a busy line drawing
 * while still letting the linework show through.
 */
export const REGION_COLOURS: Record<RegionColour, { label: string; stroke: string; fill: string }> = {
  yellow: { label: 'Yellow', stroke: '#eab308', fill: 'rgba(250, 204, 21, 0.38)' },
  orange: { label: 'Orange', stroke: '#ea580c', fill: 'rgba(249, 115, 22, 0.34)' },
  green: { label: 'Green', stroke: '#16a34a', fill: 'rgba(34, 197, 94, 0.34)' },
  blue: { label: 'Blue', stroke: '#2563eb', fill: 'rgba(59, 130, 246, 0.32)' },
  pink: { label: 'Pink', stroke: '#db2777', fill: 'rgba(236, 72, 153, 0.32)' },
}

/** Highlighter stroke width, as a fraction of the drawing's long edge. */
export const REGION_STROKE_FRACTION = 0.014

/* ----------------------------------------------------------------- photos */

export type PhotoCategory =
  | 'installation'
  | 'test'
  | 'materials'
  | 'defect'
  | 'plan'
  | 'whiteboard'
  | 'other'

export const PHOTO_CATEGORIES: Record<PhotoCategory, string> = {
  installation: 'Installation',
  test: 'Test / gauge',
  materials: 'Materials',
  defect: 'Defect',
  plan: 'Plan extract',
  whiteboard: 'Whiteboard / ID board',
  other: 'Other',
}

export interface Photo {
  id: string
  /**
   * The ITP this photo evidences. Firedoc and Reviewdoc photos keep this
   * empty and name their record through `penetrationId` / `defectId`.
   */
  itpId: string
  penetrationId?: string
  defectId?: string
  /** Plant item the photo was taken of — its sighting, for the plant register. */
  plantId?: string
  /** Project the photo belongs to, so it can be filed without a lookup. */
  projectId?: string
  /** Inspection item this photo evidences; empty for general record shots. */
  itemNo?: string
  category: PhotoCategory
  caption: string
  /** Full-size JPEG data URL, downscaled and date-stamped on capture. */
  data: string
  thumb: string
  width: number
  height: number
  /** Epoch ms the photo was taken — EXIF DateTimeOriginal when available. */
  takenAt: number
  /** True when takenAt came from the file's EXIF rather than the clock. */
  takenAtFromExif: boolean
  /** Epoch ms the photo was added to the record. */
  addedAt: number
  lat?: number
  lng?: number
  accuracy?: number
  /** Who captured it. */
  by?: string
  /**
   * Plan pin this photo was taken at, if any. The pin owns the location, so
   * the photo only needs to name it — moving or relabelling a pin does not
   * leave the photo pointing at stale coordinates.
   */
  pinId?: string
}

/* -------------------------------------------------------------- templates */

export interface TemplateMaterial {
  item: string
  requirement: string
}

export interface TemplateItem {
  /** Printed item number, e.g. "1.0". */
  no: string
  /** The "Installation" column — what is being done/checked. */
  installation: string
  /** The "Acceptance Criteria" column — the standard it is judged against. */
  acceptance: string
  point: PointType
  /** Who releases a hold point / is notified for a witness point. */
  releasedBy?: string
  /** Prompt shown to the user for a measured result, e.g. "Test pressure (kPa)". */
  recordLabel?: string
  recordUnit?: string
  /** Suggested photo evidence for this item. */
  photoHint?: string
}

/**
 * The test record every Controldoc ITP carries as its section 3.0. It is a
 * fixed form — the same eighteen rows on every ITP — so the template only
 * needs to say what the test is and what the standard demands of it.
 */
export interface TestSpec {
  /** "PRESSURE TEST", "AIR TEST", "WATER TEST", "VISUAL", "FLOW TEST", "N/A". */
  type: string
  /** Standard clause the minimum criteria come from. */
  standard: string
  /** Minimum test pressure, if a pressure test. */
  pressureKpa?: number
  /** Minimum duration. */
  minutes?: number
  /** Whether a manufacturer pre-test (e.g. Viega crimp) precedes the final test. */
  preTest?: { label: string; pressureKpa: number; minutes: number }
}

export interface ItpTemplate {
  /** Three digit code from the Controldoc library, e.g. "016". */
  code: string
  title: string
  /** "Below ground", "Above ground", "Plant & equipment". */
  group: TemplateGroup
  /** Short scope note shown in the register. */
  scope: string
  /** Primary standards this ITP is written against. */
  standards: string[]
  materials: TemplateMaterial[]
  items: TemplateItem[]
  test: TestSpec
  /** Library revision, from the Controldoc library register. */
  revision: string
  /** Minimum photographs the library requires. */
  installationPhotos: number
  testingPhotos: number
  /** Extra pages a third-party ITP form adds when supplied by the client. */
  thirdPartyPages: number
}

export type TemplateGroup = 'Below ground' | 'Above ground' | 'Plant & equipment'

export const TEMPLATE_GROUPS: TemplateGroup[] = ['Below ground', 'Above ground', 'Plant & equipment']

/* ------------------------------------------------------------------- ITPs */

/** A completed inspection item on an ITP instance. */
export interface ItpItem extends TemplateItem {
  status: ItemStatus
  /** Initials recorded against the item, mirroring "Axis Initial & Date". */
  initials?: string
  /** ISO date (yyyy-mm-dd) the item was signed. */
  date?: string
  /** Epoch ms the item was signed — the audit timestamp. */
  signedAt?: number
  signedBy?: string
  comment?: string
  /** Measured value where recordLabel is set (e.g. a test pressure). */
  recordValue?: string
  /** Hold/witness release. */
  release?: {
    releasedBy: string
    company?: string
    role?: string
    at: number
    signature?: string
    reference?: string
    note?: string
  }
  /** Notice given for a witness/hold point (date + who was notified). */
  notice?: {
    notifiedAt: number
    notifiedBy?: string
    to?: string
    method?: string
  }
}

export interface ItpMaterial extends TemplateMaterial {
  compliant: boolean | null
  /** Batch / lot / certificate reference for traceability. */
  reference?: string
  initials?: string
  checkedAt?: number
}

export interface SignOff {
  name: string
  role?: string
  company?: string
  /** Data URL of the drawn signature. */
  signature?: string
  /** Epoch ms of signing. */
  at?: number
  /** Free text, e.g. licence or CP number. */
  licence?: string
}

/** Section 3.0 of a Controldoc ITP, filled in on the day of the test. */
export interface TestRecord {
  service: string
  testType: string
  preTestStarted?: string
  preTestEnded?: string
  testStarted?: string
  testEnded?: string
  dateOfTest?: string
  preTestPressure?: string
  pressureAtStart?: string
  /** "Pressure loss (kPa) or Loss at End (ml)". */
  loss?: string
  /** "Water", "Air", "Nitrogen". */
  equipment?: string
  /** "Total Loss (kPa) or Make Up Water (ml)". */
  totalLoss?: string
  pass?: boolean | null
  complianceCheck?: boolean | null
  notes?: string
}

/** A Controldoc sign-off row: who, for whom, by when, and when they did. */
export interface Assignment {
  assignee: string
  company: string
  dueDate?: string
  signDate?: string
  signature?: string
  /** Who recorded the sign-off, when it was entered on someone's behalf. */
  enteredBy?: string
  at?: number
}

export interface Attachment {
  id: string
  name: string
  /** Data URL for small files; a SharePoint drive item URL once synced. */
  data?: string
  url?: string
  size?: number
  mime?: string
  comment?: string
  addedAt: number
}

export interface Itp extends Allocation {
  id: string
  projectId: string
  templateCode: string
  /** Number printed in the "ITP NUMBER" box. */
  itpNumber: string
  /** Controldoc ITC number — sequential across the business unit, e.g. "000299". */
  itcNumber?: string
  /** Folder path the ITP sits under, e.g. "CONTROLDOC > HYDRAULICS > COLD WATER". */
  locationPath?: string
  /** Client-scheme document reference, e.g. "LHAP-HYS-AXS-ITP-MW-L20224". */
  locRef?: string
  /** Marked-up plan reference and markup version. */
  planRef?: string
  /** 0..100, as printed on the Controldoc header. */
  progress?: number
  testRecord?: TestRecord
  attachments?: Attachment[]
  /** Section 2.0 step 15 / section 3.0 step 19: the Axis sign-off. */
  axisSignOff?: Assignment
  /** Section 3.0 step 20: the client or superintendent's additional sign-off. */
  additionalSignOff?: Assignment
  dateClosed?: string
  /** Section 2.0 step 14: "ITP Compliant with all criteria listed above". */
  compliant?: boolean | null
  /**
   * Where the device was when the work was inspected — taken when the first
   * step is signed or at the Axis sign-off, whichever comes first, because
   * ITPs are often raised in the office and signed on site.
   */
  lat?: number
  lng?: number
  accuracy?: number
  locatedAt?: number
  title: string
  /** Location this instance covers, e.g. "Southern Driveway - Plant Room". */
  area: string
  /** Level / building / grid reference. */
  location: string
  revision: string
  revisionDate: string
  documentNo: string
  /** Drawings this ITP is inspected against. */
  drawingIds: string[]
  /** Pins locating the work on those drawings. */
  pins: PlanPin[]
  /**
   * Highlighted extents showing the section of the drawing this ITP covers.
   * Optional because ITPs raised before regions existed have none.
   */
  regions?: PlanRegion[]
  materials: ItpMaterial[]
  items: ItpItem[]
  status: ItpStatus
  /** Installer's completion sign-off (bottom of page 1). */
  signOff?: SignOff
  /** Optional client / superintendent acceptance. */
  clientSignOff?: SignOff
  dateCompleted?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

/* --------------------------------------------------------------- settings */

export interface Settings {
  id: 'app'
  /** Default initials stamped when signing items. */
  userName: string
  userInitials: string
  userRole: string
  userCompany: string
  /** Signature reused for sign-off blocks. */
  userSignature?: string
  activeProjectId?: string
  /** Burn a date/time caption into captured photos. */
  stampPhotos: boolean
  /** Attach GPS coordinates to captured photos. */
  captureGps: boolean
  /** Long edge, in pixels, that photos are downscaled to before storage. */
  photoMaxEdge: number
  /**
   * Overlays live gesture state on the plan. Off by default — it exists so a
   * problem that only shows up on a particular phone can be reported with
   * facts rather than described.
   */
  showGestureDebug?: boolean
  /** Which state this person works in; empty until chosen. */
  state?: StateCode
  role: UserRole
  /** Business units the person can open. Empty for national QA means all. */
  businessUnitIds: string[]
  sync: SyncConfig
  updatedAt: number
}

/**
 * How the app reaches the shared store. Everything works with none of this
 * set — the device is the store — and switches to SharePoint once it is.
 */
export interface SyncConfig {
  /** 'local' keeps everything on the device; 'sharepoint' syncs to Microsoft 365. */
  mode: 'local' | 'sharepoint'
  /**
   * Set from the organisation's axis-config.json, which ships with the app:
   * every device connects to the same site without anyone typing anything,
   * and the connection fields are not edited per device.
   */
  managed?: boolean
  /** Organisation config: people must sign in before the app opens. */
  requireSignIn?: boolean
  /** Seconds between pulls while the app is open (org config; default 30). */
  pollSeconds?: number
  /** Entra ID (Azure AD) application registration. */
  tenantId?: string
  clientId?: string
  /** SharePoint site the QA lists live in, e.g. https://axis.sharepoint.com/sites/QA. */
  siteUrl?: string
  /** Graph site id, resolved from siteUrl on first sign-in. */
  siteId?: string
  /** Document library holding photos, plans and exported PDFs. */
  libraryName?: string
  /** Power Automate "When an HTTP request is received" URL the app posts events to. */
  powerAutomateUrl?: string
  /** Epoch ms of the last successful pull. */
  lastSyncAt?: number
  /** Epoch ms the SharePoint lists were last provisioned. */
  provisionedAt?: number
  /** Signed-in account, for display and for stamping who entered what. */
  account?: { name: string; username: string }
  /**
   * Advanced: an alternative Graph endpoint and a fixed bearer token. They
   * exist for the test harness, which stands in a mock Graph server, and for
   * a tenant that fronts Graph with a proxy. Leave blank otherwise.
   */
  graphBaseUrl?: string
  devToken?: string
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  userName: '',
  userInitials: '',
  userRole: 'Plumber',
  userCompany: '',
  stampPhotos: true,
  captureGps: true,
  photoMaxEdge: 1600,
  role: 'site',
  businessUnitIds: [],
  sync: { mode: 'local' },
  updatedAt: 0,
}

/* ------------------------------------------------------------ organisation */

/**
 * Settings shared by everyone in the organisation, kept in SharePoint rather
 * than on each device. The flow URL lives here, not in the public app
 * config: it carries its own key, and only signed-in staff should see it.
 */
export interface OrgSettings {
  id: 'org'
  /** Power Automate "When an HTTP request is received" URL for notifications. */
  powerAutomateUrl?: string
  createdAt: number
  updatedAt: number
}

/* ----------------------------------------------------------------- people */

/**
 * What a person can be told about. `allocated` is work handed to them; the
 * rest are the events the app already raises, sent to whoever in the state
 * has asked for them.
 */
export type NotifyKey =
  | 'allocated'
  | 'itp.hold_point_reached'
  | 'itp.completed_by_site'
  | 'penetration.completed_by_site'
  | 'penetration.defected'
  | 'defect.raised'
  | 'defect.closed'
  | 'plant.missing'

export const NOTIFY_LABEL: Record<NotifyKey, string> = {
  allocated: 'Work allocated to them',
  'itp.hold_point_reached': 'ITP hold points needing release',
  'itp.completed_by_site': 'ITPs completed by site, to review',
  'penetration.completed_by_site': 'Penetrations completed by site, to review',
  'penetration.defected': 'Penetrations defected at review',
  'defect.raised': 'Defects raised',
  'defect.closed': 'Defects closed',
  'plant.missing': 'Plant marked missing',
}

export const NOTIFY_KEYS = Object.keys(NOTIFY_LABEL) as NotifyKey[]

/**
 * Someone work can be allocated to and who can be notified: a profile with
 * a work email. People belong to a state like everything else; one marked
 * `allStates` (national QA, say) hears about every state.
 */
export interface Person {
  id: string
  state: StateCode
  name: string
  /** Work email the notifications go to. */
  email: string
  phone?: string
  /** Plumber, Leading hand, Supervisor, Project manager, QA… */
  role?: string
  company?: string
  notify: NotifyKey[]
  allStates?: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

export const PERSON_ROLES = ['Plumber', 'Apprentice', 'Leading hand', 'Supervisor', 'Project manager', 'State QA', 'National QA', 'Subcontractor', 'Office'] as const

/** Sensible starting notifications for a role; each person can change them. */
export function defaultNotify(role?: string): NotifyKey[] {
  switch (role) {
    case 'Supervisor':
    case 'Leading hand':
      return ['allocated', 'itp.hold_point_reached', 'penetration.defected', 'defect.raised']
    case 'Project manager':
      return ['allocated', 'itp.hold_point_reached', 'defect.raised', 'plant.missing']
    case 'State QA':
    case 'National QA':
      return ['allocated', 'itp.completed_by_site', 'penetration.completed_by_site', 'defect.raised', 'defect.closed']
    case 'Office':
      return ['allocated', 'plant.missing']
    default:
      return ['allocated']
  }
}

/* ------------------------------------------------------------- allocation */

/**
 * Who a record has been handed to. Workers are names, as on the paper forms;
 * an email, when given, lets a Power Automate flow tell them.
 */
export interface Allocation {
  assignedTo?: string
  assignedEmail?: string
  assignedAt?: number
  assignedBy?: string
  assignNote?: string
  /** ISO date it is wanted by. */
  assignDue?: string
}

/* ---------------------------------------------------------------- firedoc */

/**
 * A fire-rated penetration on the Firedoc register. The number is the call-out
 * tag on the penetration plan, so it must be unique and, once in use, never
 * changed — the plan search that pins it depends on the two being identical.
 */
export interface Penetration extends Allocation {
  id: string
  projectId: string
  /** Call-out tag, e.g. "F0001" or "L07001". */
  number: string
  kind: 'floor' | 'wall'
  level?: string
  zone?: string
  /** Nominal service size as scheduled, e.g. "100mm". */
  size: string
  sizeMm?: number
  /** Fixture / system reference from the tag: FW, SS, CO, WC, RWO, SV… */
  ref: string
  /** Pipe material: HDPE, PVC, Stainless, Copper, PEX. */
  material: string
  /** FRL of the building element, e.g. "120/120/120". */
  frl: string
  /** The building element: floor slab, block wall, 128mm fire-rated plasterboard… */
  elementMaterial: string
  /** Axis profile allocated from the Passive Fire Rating Schedule. */
  profileId?: string
  /** Plan the tag was found on, and where. */
  drawingId?: string
  x?: number
  y?: number
  /** True when the position came from the plan search rather than a hand drop. */
  autoPinned?: boolean
  /**
   * Where the device was — recorded when the penetration is added or first
   * completed by site, so a collar can be found again on a floor with no plan
   * to hand, and the record shows it was signed where it was installed.
   */
  lat?: number
  lng?: number
  accuracy?: number
  locatedAt?: number
  status: QaStatus
  installedBy?: string
  installedAt?: number
  reviewedBy?: string
  reviewedAt?: number
  /** Why it was defected, and what was done about it. */
  defect?: string
  rectifiedAt?: number
  /** Label / sticker serial applied at the penetration. */
  stickerNo?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

/* -------------------------------------------------------------- reviewdoc */

/**
 * Service prefixes used on Reviewdoc descriptions ("CW: …", "Fire Rating: …"),
 * which the QA report groups value and quantity by.
 */
export type ServiceType =
  | 'Fire Rating'
  | 'Sanitary Drainage'
  | 'Sanitary Plumbing'
  | 'Stormwater'
  | 'Trade Waste'
  | 'CW'
  | 'HW'
  | 'Gas'
  | 'Fire Hydrant'
  | 'Fire Sprinkler'
  | 'Incomplete work'
  | 'Damage'
  | 'Housekeeping'
  | 'Other'

export const SERVICE_TYPES: ServiceType[] = [
  'Fire Rating',
  'Sanitary Drainage',
  'Sanitary Plumbing',
  'Stormwater',
  'Trade Waste',
  'CW',
  'HW',
  'Gas',
  'Fire Hydrant',
  'Fire Sprinkler',
  'Incomplete work',
  'Damage',
  'Housekeeping',
  'Other',
]

export type DefectStatus = 'open' | 'rectified' | 'closed'

export const DEFECT_STATUS_LABEL: Record<DefectStatus, string> = {
  open: 'Open',
  rectified: 'Rectified — awaiting review',
  closed: 'Closed',
}

/** One Reviewdoc item: a costed, located, photographed defect. */
export interface Defect extends Allocation {
  id: string
  projectId: string
  /** Sequential ID as printed, e.g. "0005". */
  number: string
  /** Plan it was found on, with the mini-map pin. */
  drawingId?: string
  x?: number
  y?: number
  /** Folder path shown on the report, e.g. "Reviewdoc ABS > 370. ASB PENETRATION LAYOUT L 04". */
  locationPath?: string
  locRef?: string
  service: ServiceType
  description: string
  /** Estimated rectification cost, AUD. */
  cost?: number
  /**
   * Where the device was when the defect was raised — the plan pin says where
   * on the drawing, this says where on the earth, which is what finds it again
   * on a site with no plan to hand.
   */
  lat?: number
  lng?: number
  accuracy?: number
  locatedAt?: number
  status: DefectStatus
  raisedBy?: string
  raisedAt: number
  assignedTo?: string
  dueDate?: string
  rectifiedAt?: number
  rectifiedBy?: string
  closedAt?: number
  closedBy?: string
  createdAt: number
  updatedAt: number
}

/* -------------------------------------------------------------------- sync */

/**
 * A change waiting to reach SharePoint. Every write lands here as well as in
 * the local store, so the app behaves identically with or without signal and
 * nothing is lost if the tab closes mid-upload.
 */
export interface OutboxEntry {
  id: string
  table: string
  recordId: string
  op: 'put' | 'delete'
  at: number
  attempts: number
  lastError?: string
}

/* ------------------------------------------------------------------ plant */

/**
 * Where a piece of plant stands. "Available" is at a yard or office and free
 * to go out; "On site" is on a job. Out of service covers broken and awaiting
 * repair or test; disposed covers destroyed and written off, kept on the
 * register so the history survives.
 */
export type PlantStatus = 'available' | 'on_site' | 'out_of_service' | 'missing' | 'disposed'

export const PLANT_STATUS_LABEL: Record<PlantStatus, string> = {
  available: 'Available',
  on_site: 'On site',
  out_of_service: 'Out of service',
  missing: 'Missing',
  disposed: 'Disposed',
}

export const PLANT_STATUSES: PlantStatus[] = ['available', 'on_site', 'out_of_service', 'missing', 'disposed']

/**
 * A state's yard or office. A sighting within its radius puts the item there
 * and makes it available. The position starts from the address and is
 * confirmed by standing there with a phone.
 */
export interface Depot {
  id: string
  state: StateCode
  name: string
  address: string
  lat?: number
  lng?: number
  /** Metres around the position that count as "here". */
  radius: number
  /**
   * How the position was found. A seeded one is only the suburb, so it is
   * matched generously until the address is looked up or someone sets it on
   * site.
   */
  source?: 'seed' | 'address' | 'device' | 'manual'
  /** Where an item checked in here is said to be — "Yard" unless changed. */
  defaultArea?: string
  createdAt: number
  updatedAt: number
}

/** One entry in an item's movement history. */
export interface PlantMove {
  at: number
  by?: string
  status: PlantStatus
  location: string
  depotId?: string
  projectId?: string
  lat?: number
  lng?: number
  accuracy?: number
  /** How it was recorded. */
  via: 'photo' | 'scan' | 'stocktake' | 'manual' | 'import'
  photoId?: string
  note?: string
}

/**
 * A tool or piece of plant on a state's register — the AXIMSRG-03 Plant &
 * Equipment Register, one row per item. `plantNo` is the register's own
 * unique number, printed on the item's QR label; `axisNo` is the number
 * painted or engraved on the tool, which the old register used but which is
 * missing on most items and repeated on some.
 */
export interface PlantItem extends Allocation {
  id: string
  state: StateCode
  /** Unique per state, e.g. "SA-0412". The QR label carries it. */
  plantNo: string
  /** Number marked on the tool, e.g. "AXP 80". */
  axisNo?: string
  /** Equipment type, e.g. "Hammer Drill". */
  type: string
  brandModel: string
  serial: string
  status: PlantStatus
  /** Where it is: "Yard", "Office", or the job. */
  location: string
  depotId?: string
  projectId?: string
  /** Last known position and when it was taken. */
  lat?: number
  lng?: number
  accuracy?: number
  locatedAt?: number
  /** Last time someone photographed or scanned it. */
  seenAt?: number
  seenBy?: string
  /** "Calibration test" column — Yes / No, or the date it was calibrated. */
  calibration?: string
  calibratedAt?: string
  /** "Last service or Test/Tag" — ISO date, or a note such as who tagged it. */
  lastTestAt?: string
  lastTestNote?: string
  dateOffSite?: string
  /** "Date of Entry" on the register. */
  enteredAt?: string
  labelPrintedAt?: number
  notes?: string
  history: PlantMove[]
  createdAt: number
  updatedAt: number
}
