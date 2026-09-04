/**
 * Domain model for hydraulic services Inspection & Test Plans.
 *
 * The shape follows the paper ITP it replaces: a header block, a materials
 * verification table, a numbered inspection & test schedule where every row
 * carries an inspection point type, and a sign-off block.
 */

/**
 * Inspection point classification, using the legend printed on the ITP:
 * W - Witness; H - Hold Point; S - Surveillance; X - Self Inspection.
 */
export type PointType = 'H' | 'W' | 'S' | 'X'

export const POINT_TYPES: Record<PointType, { label: string; short: string; cls: string; help: string }> = {
  H: {
    label: 'Hold Point',
    short: 'HOLD',
    cls: 'chip--hold',
    help: 'Work must not proceed past this item until it is released by the nominated party.',
  },
  W: {
    label: 'Witness Point',
    short: 'WITNESS',
    cls: 'chip--witness',
    help: 'The nominated party is given notice and may attend. Work may proceed if they do not attend.',
  },
  S: {
    label: 'Surveillance',
    short: 'SURV',
    cls: 'chip--surv',
    help: 'Monitored by the nominated party on an ongoing or sampled basis.',
  },
  X: {
    label: 'Self Inspection',
    short: 'SELF',
    cls: 'chip--self',
    help: 'Inspected and recorded by the installing tradesperson.',
  },
}

export type ItemStatus = 'pending' | 'pass' | 'fail' | 'na'

export type ItpStatus = 'draft' | 'in_progress' | 'awaiting_hold' | 'complete' | 'closed'

export const ITP_STATUS_LABEL: Record<ItpStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  awaiting_hold: 'Awaiting release',
  complete: 'Complete',
  closed: 'Closed out',
}

/* ---------------------------------------------------------------- project */

export interface Project {
  id: string
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
  createdAt: number
}

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
  itpId: string
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
  /** Optional drawing pin recording where on the plan this was taken. */
  drawingId?: string
  pinX?: number
  pinY?: number
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

export interface ItpTemplate {
  /** Three digit code from the ITP register, e.g. "002". */
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

export interface Itp {
  id: string
  projectId: string
  templateCode: string
  /** Number printed in the "ITP NUMBER" box. */
  itpNumber: string
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
  updatedAt: number
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
  updatedAt: 0,
}
