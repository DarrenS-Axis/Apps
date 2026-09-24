# Axis QA

The Axis Plumbing QA system as a web app: **Controldoc** (Inspection & Test Plans),
**Firedoc** (the fire-rated penetration register) and **Reviewdoc** (the QA defect
register), for every state, on a phone in the field, with the numbers rolling up to the
national QA report.

It runs offline-first on the device and syncs to **SharePoint** in your Microsoft 365
tenant, with **Power Automate** picking up events and list changes for notifications and
reporting. Each state operates in its own silo; national QA sees everything.

Live: <https://darrens-axis.github.io/Apps/>

---

## How it is organised

```
National QA ───────────── every state, reporting
  └─ State (NSW, ACT, QLD, VIC, NT, WA, SA, TAS)
       └─ Business unit (NSW Major Works, NSW Med Gas, NSW Small Works, QLD …)
            └─ Project (Liverpool Hospital, Pitt Street OSD …)
                 ├─ Controldoc   ITPs from the 43-item library
                 ├─ Firedoc      penetrations, allocated against the fire schedule
                 ├─ Reviewdoc    costed, located, photographed defects
                 ├─ Plans        drawings, imported from PDF, pinned and highlighted
                 └─ Photos       timestamped, GPS-tagged evidence
```

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
- **Axis sign-off** and the **additional sign-off** (client / superintendent), which
  moves the ITP to Reviewed & approved.

The exported PDF carries all of it in the Controldoc layout.

### Firedoc — penetration register

- **Import the consultants' Autopin register** (Excel or CSV) straight from the file the
  requirements document asks them for — number, size, level / zone, reference, material,
  FRL, building element, wall and floor tabs. Re-issued registers update in place; a
  number never changes once in use.
- **Autopin from the penetration plan PDF.** The plan is rendered into drawings and
  searched for every register number; a tag reading `F0001-FW-100mm` is found by `F0001`,
  exactly as the requirements set out ("the dash breaks the search string"). Matched
  penetrations are pinned where their call-out sits.
- **The Passive Fire Rating Schedule is built in** — all 202 profiles across the six
  building-element sections (2hr and 4hr concrete slabs, composite steel slabs, masonry
  and plasterboard walls, speed panel), filtered by element and size, with the product,
  FRL, test reports and installation notes. A penetration cannot be completed until a
  profile is allocated.
- **Workflow** — Setup → In progress → Completed by site → Reviewed & approved or
  Defected, the columns of the monthly report.

### Reviewdoc — defects

- Raise a defect on a QA walk: tap the plan where it is, prefix the service (Fire Rating,
  CW, Sanitary Drainage, Incomplete work …), describe it, cost it, photograph it.
- Rectified by site → reviewed and closed by QA.
- **QA REPORT** export to the head contractor: cover page, then ID, location, mini map,
  description, cost and photo per defect, as the Controldoc report lays it out.

### QA report

The monthly report, live, for a business unit, a state or the nation: the Firedoc summary
(Setup / In progress / Completed by site / Reviewed & approved / Defected / Outstanding per
project), the completed-ITP trend over three months, and Reviewdoc value and quantity by
service type and by project.

## Microsoft 365: SharePoint and Power Automate

Every record is written to the device first and queued for SharePoint, so the app behaves
identically with no signal. Set up once, from Settings → Microsoft 365:

1. An Entra ID **single-page application** registration (no secret — PKCE) with delegated
   `User.Read`, `Sites.ReadWrite.All`, `Files.ReadWrite.All`. Tenant ID and client ID go
   into Settings.
2. The SharePoint site URL. **Provision** creates the seven `QA …` lists and the
   `QA Files` library, and adds any column an upgrade needs. Safe to run again.
3. **Sync now**, or leave it: the app syncs on coming online, on returning to the tab and
   every five minutes.

Each list carries the full record as JSON plus plain columns — state, project, status,
ITC number, cost, profile — so Power Automate and Power BI filter and total without
parsing anything. Each state pulls only its own records; national QA pulls all.

The app also posts events (`itp.completed_by_site`, `itp.hold_point_reached`,
`penetration.defected`, `defect.raised` …) to a Power Automate **When an HTTP request is
received** URL. `flows/README.md` sets out the three flows — notify the state QA channel,
hold point reminders, the scheduled monthly report — with the list columns and the
request schema, and `flows/notify-state-qa.json` is the first flow's definition.

Not configured? The app is fully usable on the device, with JSON backup and restore
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

Nine Playwright suites drive the production build in a real browser, including
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
- **Worked examples** — `examples/` holds exported ITPs; `tools/make-examples.mjs`
  regenerates them by driving the app.

## Layout

```
src/
  data/
    types.ts            domain model: states, business units, projects, ITPs,
                        penetrations, defects, photos, sync
    db.ts               Dexie store, migrations, outbox that feeds SharePoint
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
  lib/
    xlsx.ts             .xlsx / .csv reader, no dependencies
    autopin.ts          penetration tag search on plan PDFs
    reporting.ts        the monthly report computations
    pdf.ts              Controldoc ITP, ITP register and Reviewdoc QA report PDFs
  pages/                Welcome, StateHome, Project, Register, Itp, Firedoc,
                        Reviewdoc, Drawings, Photos, Reports, Settings
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
