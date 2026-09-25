# Axis QA

The Axis Plumbing QA system as a web app: **Controldoc** (Inspection & Test Plans),
**Firedoc** (the fire-rated penetration register) and **Reviewdoc** (the QA defect
register), for every state, on a phone in the field, with the numbers rolling up to the
national QA report — plus each state's **plant register**, tracked by photo, GPS and QR
label.

It runs offline-first on the device and syncs to **SharePoint** in your Microsoft 365
tenant, with **Power Automate** picking up events and list changes for notifications and
reporting. Each state operates in its own silo; national QA sees everything.

Live: <https://darrens-axis.github.io/Apps/>

---

## How it is organised

```
National QA ───────────── every state, reporting
  └─ State (NSW, ACT, QLD, VIC, NT, WA, SA, TAS) and NZ
       └─ Business unit (NSW Major Works, NSW Med Gas, NSW Small Works, QLD …)
            └─ Project (Liverpool Hospital, Pitt Street OSD …)
                 ├─ Controldoc   ITPs from the 43-item library
                 ├─ Firedoc      penetrations, allocated against the fire schedule
                 ├─ Reviewdoc    costed, located, photographed defects
                 ├─ Plans        drawings, imported from PDF, pinned and highlighted
                 └─ Photos       timestamped, GPS-tagged evidence
       └─ Plant register  every tool and piece of plant, its yards and offices
```

**Each business's logo** is part of the app: in the app bar on every screen (the open
project's business, or the person's own), at the top of the home page (every business's for
national QA) and on each business unit's section, on the ITP screen, in the contractor cell
of the ITP PDF, on the ITP register and QA report PDFs, and on the plant labels and plant
list. Built in: ACT, NT, NZ, SA and VIC. Any unit's logo can be uploaded (or replaced) in
Settings → Business units, which reaches every device; a unit without one shows the AXIS
tile. A logo uploaded on a project still wins for that project's PDFs. Trading names match
the logos (Axis Plumbing NSW Group, Axis Plumbing Small Works Group, Axis Plumbing ACT,
Axis Services VIC, Axis Services Group WA, Axis Services SA, Axis Plumbing NZ …).

On first run the app asks who you are, which state you work in and your access level.
**Site** and **State QA** see only their state's business units and projects — on the
device and in what is pulled from SharePoint. **National QA** sees every state, and the QA
report can be switched between states or run nationally.

## The three modules

### Controldoc — Inspection & Test Plans

The 43 hydraulic ITPs of the Axis Controldoc library, in the library's numbering (001
Inground Sanitary Drainage … 043 Non Potable Water Tank), each with the revision and the
installation / testing photograph minimums the library register sets. A raised ITP owns
its own copy, so step wording and keys can be tuned to the project specification.

Every ITP follows the Controldoc form:

- **ITC #** — sequential across the business unit (`000299`), plus the client's document
  reference from a per-project scheme (`LHAP-HYS-AXS-ITP-MW-{n}`) and the Controldoc
  location path.
- **1.0 Materials** — items and requirements, verified with batch / WaterMark references.
- **2.0 Checklist** — steps with acceptance criteria, keyed **H** Hold Point, **M** Monitor /
  Surveillance, **W** Witness, **X** Self Inspection by performer of work. Steps below an
  unreleased hold point are blocked; releasing one records who, for whom, the inspection
  reference and a drawn signature.
- **3.0 Test record** — the fixed form: the standard's minimum criteria, service, test
  type, times, date, pressures, equipment, loss, pass, compliance check.
- **4.0 Attachments and photographs** — plan extracts with the covered extent highlighted
  and pins located, and the photographic record.
- **Plans and location from inside the ITP** — import a plan on the ITP's Plans tab (from
  the device, SharePoint or OneDrive; it is linked to the ITP as it comes in), drop pins
  and move them later. Each pin records where the device was; the ITP records where it
  was inspected when its first step is signed or a pin is dropped — on site, not where it
  was raised — with refresh, clear and open-in-maps. Both print on the PDF.
- **Axis sign-off** and the **additional sign-off** (client / superintendent), which
  moves the ITP to Reviewed & approved.

The exported PDF carries all of it in the Controldoc layout.

### Firedoc — penetration register

- **Import the consultants' Autopin register** (Excel or CSV) straight from the file the
  requirements document asks them for — number, size, level / zone, reference, material,
  FRL, building element, wall and floor tabs. Re-issued registers update in place; a
  number never changes once in use.
- **Autopin from the penetration plan PDF.** Works on the drawings the industry issues —
  a coloured penetration symbol (disc with a crosshair) with a size-and-type tag beside it
  such as `100 FW`, `40 B`, `ST 100` or `40 IWTD`. The PDF's text is read for tags, the
  symbols are found from the drawing's own vector linework (with an image search as a
  fallback for scanned sheets), and each tag is paired with its nearest symbol so the pin
  sits on the penetration, not the text. Titles, grid lines, dimensions and labels like
  `SPECT 01` are ignored. Symbols whose tag is incomplete (`B` with no size) are offered
  too, flagged to confirm size and type with the consultant. A preview shows every pin,
  the types read (`40 B × 20`) and the numbers to be allocated (`F0001`… in reading order,
  skipping numbers in use) before anything is written; the sheet is added to Plans and
  running Autopin on it again creates no duplicates. Plans tagged with register numbers
  (`F0001-FW-100mm`, found by `F0001` — "the dash breaks the search string") still pin
  the imported register instead.
- **The Passive Fire Rating Schedule is built in** — all 202 profiles across the six
  building-element sections (2hr and 4hr concrete slabs, composite steel slabs, masonry
  and plasterboard walls, speed panel), filtered by element and size, with the product,
  FRL, test reports and installation notes. A penetration cannot be completed until a
  profile is allocated.
- **Place and locate every penetration.** From a penetration's own sheet, choose a plan
  or import one (from the device, SharePoint or OneDrive via the file picker; multi-sheet
  PDFs ask which sheet), drop the pin and move it later — a pin moved by hand stops being
  marked as autopinned. Adding a penetration offers the same. The device's position is
  recorded on add and, if nothing was recorded yet, when the penetration is completed by
  site — so the record shows where it was signed, with a link to open it in maps.
- **Workflow** — Setup → In progress → Completed by site → Reviewed & approved or
  Defected, the columns of the monthly report.

### Reviewdoc — defects

- Raise a defect on a QA walk: choose or import the plan from inside the defect, tap
  where it is, prefix the service (Fire Rating, CW, Sanitary Drainage, Incomplete work …),
  describe it, cost it, photograph it. The device's position is recorded with it, and the
  pin can be moved or the plan changed later. A Plan view shows every defect on a sheet.
- Rectified by site → reviewed and closed by QA.
- **QA REPORT** export to the head contractor: cover page, then ID, location, mini map,
  description, cost and photo per defect, as the Controldoc report lays it out.

### Plant register — tools and plant, per state

The Plant tab holds the state's AXIMSRG-03 Plant & Equipment Register, live.

- **Import the register** from the Excel file as the office keeps it (title block, job
  list, notes, then Equipment Type · Brand and Model · Serial # · Location · Date off site ·
  Calibration test · Last service or Test/Tag · Axis No. · Date of Entry). Location becomes
  a status: *Yard* / *Office Only* → available at the yard or office, a job name → on site
  (linked to the project when one matches), *Broken* → out of service, *DESTROYED* →
  disposed. Spellings of one job are merged (`EDinburgh` → `Edinburgh`). Every item gets a
  register number — `SA-0001` … — for its QR label; the number marked on the tool (Axis
  No.) is kept beside it, since most items have none and some share one. Importing a newer
  copy updates items in place (matched on type, brand, serial and Axis No., one for one) and
  never moves an item that has been photographed or scanned since.
- **Photo & locate.** Photograph an item and the phone's position (from the photo, or a
  fresh fix) decides where it is. Within a **yard or office** it is back there and
  *available*; near a job where ITPs, penetrations, defects or plant have been located it
  is *on site* at that job; anywhere else the app asks which job. Every move is kept in the
  item's history with who, when, how and the coordinates.
- **Map.** *List / Map* on the Plant tab puts every item at the GPS of its last photo or
  scan, on OpenStreetMap, coloured by status — the same items the filters show, so it can
  be one job, the missing items or a search. Items that crowd together share a numbered
  pin (a ring shows the mix of statuses) that parts as you zoom; tapping one lists what is
  there and opens any item. Yards and offices are marked with the distance that counts as
  there. *Show on map* on an item draws its trail — every located sighting, oldest to
  newest. Items not yet photographed or scanned are counted under the map rather than
  guessed onto it. The map loads only when opened; offline the tiles are grey but the pins
  are still placed.
- **Yards and offices.** SA starts with *Beverley office & yard*, Unit 2/21 Alfred Ave,
  Beverley SA 5009. Until its position is confirmed it is placed from the suburb and
  matched generously; the app looks the address up when there is signal, or set it by
  standing there and tapping *I'm here — use my location*. Add more per state.
- **QR labels.** A4 sheets of 21 (Avery L7160 / J8160), or one label from the item. Each
  carries the plant number, the item and a QR code linking to it, so **any phone camera**
  opens the item. In the app, **Scan QR** reads labels with the live camera (the browser's
  barcode reader where there is one, a JavaScript decoder otherwise), from a photo of the
  label, or by typing the number. Scanning records where the item was seen. A label not on
  the register yet offers to add the item under its number.
- **Stocktake.** Scan item after item; each is recorded where you stand. At a yard, the
  items the register says are there but that were not scanned are listed and can be marked
  missing in one go.
- **Checks.** On site and not seen for 60 days; test & tag overdue (three-monthly, per
  AS/NZS 3760 on construction sites, from the register's last test date); never labelled;
  never located. Each is a filter and a count.
- **Exports.** The plant list PDF in the register's layout (for the principal contractor on
  the first of the month, filtered to a job), and CSV in the register's own columns plus
  plant number, status, last seen and GPS — which imports straight back.
- A project's hub shows how much plant is on the job and links to it.

### Saving, allocating and people

Every record — ITP, penetration, defect, piece of plant — ends in a bar that stays in
reach (at the foot of the sheet, or pinned above the tabs on the ITP page): **Save** (fields are written as you type; Save commits any open form, confirms and
closes; on an ITP it returns to the register), **Allocate to worker** and **Delete** off to
one side.

- **People** (Settings → People & notifications): a profile per worker — name, **work
  email**, mobile, role, state — added by hand or from a CSV (Name, Email, Role, Phone,
  State). Each person ticks what they want to be emailed about: work allocated to them,
  hold points needing release, ITPs and penetrations completed by site, penetrations
  defected, defects raised or closed, plant gone missing. The role sets sensible
  defaults. *Every state* is for national QA; *Send test* checks the email arrives.
- **Allocate** picks a person (their work email fills in), a date wanted by and a note.
  A new name with an email becomes a profile. The allocation is on the record, in list
  rows (→ Joe Bloggs), searchable, in the item's history for plant, and on SharePoint.
  *Reallocate* or *Take back* later.
- **Notifications** go out through the Power Automate flow (`flows/README.md`, Flow 0):
  each event names who to email — the worker it was allocated to plus everyone who asked
  for that event in the state — and links straight to the record. With no flow set up,
  allocating offers *Email Joe* instead: the phone's mail app opens with the message
  written. Hold points reached and ITPs completed or accepted now raise events too.
- **Allocated to you** on the home screen lists the user's own work, due dates first,
  overdue in red.

### QA report

The monthly report, live, for a business unit, a state or the nation: the Firedoc summary
(Setup / In progress / Completed by site / Reviewed & approved / Defected / Outstanding per
project), the completed-ITP trend over three months, and Reviewdoc value and quantity by
service type and by project.

## Everyone on the same data: going live

Out of the box each device keeps its own records. Connected to the company's Microsoft
365, **everyone who opens the app — or any link from it, on any phone, tablet or laptop —
sees the same projects, ITPs, penetrations, defects, plant and people**, after signing in
with their Axis work account. Nothing is set up on the devices: the connection ships with
the app.

**One-time setup (an IT / Microsoft 365 admin, about 15 minutes):**

1. **A SharePoint site** for the QA data, e.g. `https://axisplumbing.sharepoint.com/sites/QA`
   (a new team site is fine). Everyone who uses the app needs access to it (Members).
2. **An app registration** in Entra ID (portal.azure.com → App registrations → New):
   - Name *Axis QA*; accounts in this organisational directory only.
   - Platform **Single-page application**, redirect URI **`https://darrens-axis.github.io/Apps/`**
     (the exact address the app is opened at, with the trailing slash).
   - API permissions → Microsoft Graph → *Delegated*: `User.Read`, `Sites.ReadWrite.All`,
     `Sites.Manage.All`, `Files.ReadWrite.All` → **Grant admin consent**.
   - No client secret — the app is a public client and signs in with PKCE.
   - Note the **Directory (tenant) ID** and **Application (client) ID**.
3. **Tell the app**, in this GitHub repository → Settings → Secrets and variables →
   Actions → **Variables** (these are not secrets):
   - `AXIS_TENANT_ID` — the directory (tenant) id
   - `AXIS_CLIENT_ID` — the application (client) id
   - `AXIS_SITE_URL` — the SharePoint site
   - optional `AXIS_POLL_SECONDS` — how often an open app checks for others' changes (30)

   Then re-run the *Deploy to GitHub Pages* workflow (or push anything). The deploy writes
   `axis-config.json` beside the app; a committed `public/axis-config.json` works too.
4. **First sign-in** by someone with owner rights on the site: the app creates the `QA …`
   lists and the `QA Files` library itself. Then set the **Power Automate flow URL** once in
   Settings → Microsoft 365 — it is kept in SharePoint for everyone, not in the public app,
   because the URL carries its own key.

**What people see:** the link opens a *Sign in to Axis QA* screen; they sign in once with
their work account and stay signed in. Their name comes from the account, and if they have
a People profile under that email their state and access are filled in. A link opened on a
new device — from an email, a QR label or a colleague — lands on that record after sign-in
and the welcome.

**How it stays the same everywhere:** every change is written on the device first (so it
works with no signal) and sent to SharePoint within about two seconds; open apps check for
everyone else's changes every 30 seconds, when they come back on screen and when they
regain signal. A record not on the device yet — a link or a QR label from someone else — is
fetched on the spot. Each state receives only its own records (national QA receives all);
people, business units and the organisation settings are shared across states. A device
does not fetch any state's records until its person has said which state they are in.

## Microsoft 365: SharePoint and Power Automate

Each list carries the full record as JSON plus plain columns — state, project, status,
ITC number, cost, profile, plant number, location, last seen, assigned to — so Power
Automate and Power BI filter and total without parsing anything.

A device can also be connected by hand (Settings → Microsoft 365 → *Sync to SharePoint*,
with the tenant id, client id and site URL, then *Provision SharePoint lists*) — useful for
trying it out before the organisation config is in place.

The app posts events (`itp.completed_by_site`, `itp.hold_point_reached`, `*.allocated`,
`defect.raised` …), each naming the people to email, to a Power Automate **When an HTTP
request is received** URL. `flows/README.md` sets out the flows — email the people, notify
the state QA channel, hold point reminders, the monthly report — with the list columns and
the request schema.

Not connected? The app is fully usable on the device, with JSON backup and restore
between devices.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run preview      # serve dist/ locally
```

Deploys to GitHub Pages from `.github/workflows/deploy-pages.yml` on every push. Add the
Pages URL as a redirect URI on the Entra app registration.

## Tests

Sixteen Playwright suites drive the production build in a real browser, including
`smoke-sharepoint.mjs`, which runs the whole SharePoint path against a mock Graph server:
provision, push from one device, pull on a fresh one, the QLD silo and the national
roll-up. See `tests/README.md`.

```bash
npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
npm install --no-save playwright
npm run smoke
```

## Maintenance

- **Fire schedule revised** — `python3 tools/import-fire-schedule.py <xlsx> "<revision>"`
  regenerates `src/data/libraries/fireProfiles.ts`.
- **ITP library** — `src/data/libraries/itpLibrary.ts` is the register; the checklist
  content lives in `src/data/templates/`.
- **Business units** — seeded from `src/data/libraries/states.ts`; edit, add and rename in
  Settings.
- **Logos** — built-in ones are `src/assets/logos/*.png`, listed per unit and state in
  `src/data/libraries/logos.ts`; or upload a unit's logo in Settings → Business units. Yards and offices are seeded there too and edited from the Plant tab.
- **Worked examples** — `examples/` holds exported ITPs; `tools/make-examples.mjs`
  regenerates them by driving the app.

## Layout

```
src/
  data/
    types.ts            domain model: states, business units, projects, ITPs,
                        penetrations, defects, photos, plant, depots, sync
    db.ts               Dexie store, migrations, outbox that feeds SharePoint
    plant.ts            plant numbering, sightings, yard / job placement, moves
    people.ts           people profiles and who each notification goes to
    store.ts            live-query hooks, state-scoped
    libraries/          itpLibrary (43), fireProfiles (202), states
    templates/          Controldoc checklist content
  sync/
    auth.ts             Entra ID sign-in (MSAL, loaded on demand)
    graph.ts            Microsoft Graph client
    schema.ts           list columns and record → fields mapping
    provision.ts        creates lists, library and columns
    engine.ts           outbox push, state-scoped pull, file upload
    events.ts           Power Automate event feed
    orgConfig.ts        the organisation's connection, shipped as axis-config.json
  lib/
    xlsx.ts             .xlsx / .csv reader, no dependencies
    autopin.ts          penetration tags + symbols on plan PDFs
    plantRegister.ts    AXIMSRG-03 register import, CSV export
    plantPdf.ts         QR label sheets and the plant list PDF
    qr.ts               QR codes: links, drawing, decoding
  components/PlantMap   the plant map (Leaflet, loaded on demand)
  components/RecordFooter  Save / Allocate / Delete bar on every record
  components/PeopleAdmin   Settings → People & notifications
    reporting.ts        the monthly report computations
    pdf.ts              Controldoc ITP, ITP register and Reviewdoc QA report PDFs
  components/QrScanner  camera, label-photo and typed QR reading
  pages/                Welcome, StateHome, Project, Register, Itp, Firedoc,
                        Reviewdoc, Drawings, Photos, Plant, Reports, Settings
flows/                  Power Automate guide and flow definition
tests/                  browser suites and the mock Graph server
```

## Design notes

**Offline first, SharePoint second.** A hook on every synced table queues the change once
its transaction commits; the outbox is drained on sync and a failed push is retried, so a
phone in a plant room and a laptop in the office write the same store. Last writer wins on
`updatedAt`, and a local record with an edit still queued is never overwritten by an older
remote copy. Photos and plans go to the document library; the list holds the thumbnail
and the path, and the full image is fetched when it is first needed.

**The state is enforced by the pull, not just the screen.** A device asks SharePoint for
its state's records only, so a NSW phone never holds QLD data to leak.

**Seeded business units are stamped `updatedAt 0` and never uploaded.** A unit renamed in
one place is newer than any seed, so it wins everywhere, and a fresh device cannot push
the defaults back over it.

**The plan is drawn on a canvas, not scaled as an image**, so a 2600 px plan zoomed to 16×
is one viewport of GPU memory rather than a 690-megapixel layer — the cause of the
original crashes on site. Gestures are tracked on the window because a pinch releases its
fingers off the viewer, and a new touch flagged primary clears the pointer map, so a
missed release cannot wedge it.

**The ITP register is data, not code.** The 43 titles, revisions and photograph minimums
are the library spreadsheet; the checklist content is composed from shared rows, so a
change to how a hydrostatic test is described lands on every ITP that has one.
