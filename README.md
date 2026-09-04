# Hydraulic ITP Manager

An offline-first field app for raising, completing and closing out hydraulic services
**Inspection & Test Plans**. It replaces the printed ITP with something a plumber can
work from on a phone in a trench: the same schedule, the same hold points, the same
sign-off block — plus timestamped photographic evidence and the ability to mark exactly
where on the plan each inspection took place.

It exports back to a PDF laid out like the paper form it replaces, so the document
controller receives what they already expect.

---

## What it does

**42 hydraulic ITPs, ready to raise.** The register covers the full hydraulic scope —
inground drainage and services (001–014), above ground services (015–029), and plant and
equipment (030–042). Each template carries its materials verification table, its numbered
inspection schedule, acceptance criteria citing the applicable AS/NZS standards, and an
inspection point type per item.

**Hold points that actually hold.** Every item is classified `H` (Hold), `W` (Witness),
`S` (Surveillance) or `X` (Self inspection), the same legend printed on the paper form.
Items below an unreleased hold point are visibly blocked, and releasing one captures the
releasing party, their company, a reference number (inspection or consent number) and a
drawn signature.

**Timestamped photos.** Photos are taken through the rear camera or picked from the
gallery. Capture time comes from the file's EXIF `DateTimeOriginal` where the camera
provides it, falling back to the clock — and the record says which of the two was used,
so the evidence trail is honest. The date, time, ITP number and area are burned into the
image itself, so the timestamp survives the photo being copied out of the app. GPS is
attached from EXIF or the device where available, and capture is never blocked when it
is not.

**Plans and locations.** Load plan images into the drawing register, link them to an ITP,
then tap the plan to drop a numbered pin — optionally tied to a specific schedule item —
with a note like "IO at grid 3, IL 21.30". The exported PDF includes the plan with those
pins drawn on it, plus the pin schedule.

**Sign-off.** An installer sign-off block with drawn signature, licence / CP number and
completion date, and a separate client / superintendent acceptance block that closes the
ITP out.

**Exports.** A per-ITP PDF matching the source layout, and a landscape ITP register for
the whole job showing progress, open hold points and non-conformances. Full JSON backup
and restore for moving a job between devices.

**Offline.** Everything is stored in IndexedDB on the device and the app shell is
precached by a service worker, so it works with no signal and installs to the home screen
as a PWA.

---

## Running it

```bash
npm install
npm run dev        # development server
npm run build      # production build to dist/
npm run preview    # serve the production build
npm run typecheck  # TypeScript, no emit
```

`dist/` is a static bundle — host it anywhere, including a subdirectory. Routing is
hash-based and asset paths are relative, so no server rewrite rules are needed.

Note that the camera, GPS and service worker require a secure context: `https://` or
`localhost`.

---

## Using it on site

1. **Settings** — enter your name and initials once. They are stamped into the
   "Initial & Date" column each time you sign an item. Optionally save a signature.
2. **Job** — create the job with its number, stage, client and the person who approves
   ITPs for use. These fill the header block of every exported ITP.
3. **Plans** — add the drawings you are working to, with number, revision and a plan
   image.
4. **ITPs → ITP register** — find the ITP for the service you are installing, raise it
   against an area (one per discrete section, as the paper form is issued), and tick the
   drawings it is inspected against.
5. **Work through the schedule** — tap an item to open it, record the result, capture the
   measured value where one is asked for, take photos, and sign. Hold and witness points
   prompt for a release or a notice.
6. **Plans tab** — drop pins where the work was inspected.
7. **Sign-off** — sign when everything is signed and clear, then export the PDF.

---

## Templates and standards

Templates cite AS/NZS standards as a **starting point** — AS/NZS 3500 parts 1 to 4,
AS/NZS 5601.1, AS/NZS 1596, AS 2419.1, AS 2118.1, AS 2941, AS 2441, AS 2304, AS 1940 and
others as they apply to each service. They are written to reflect common Australian
practice, not to replace the project's own quality plan.

Every raised ITP takes its **own copy** of the schedule. Item wording, acceptance
criteria, the nominated releasing party and the inspection point type are all editable on
the instance, so an ITP can be tuned to the project specification, the head contractor's
quality requirements or the local authority's conditions without touching the register.
Review each ITP against the project's hydraulic specification and the approved quality
plan before it is issued for use.

---

## Architecture

```
src/
  data/
    types.ts              domain model — ITPs, items, point types, photos, pins
    db.ts                 Dexie schema and all read/write operations
    store.ts              React hooks over Dexie liveQuery
    templates/
      common.ts           reusable schedule rows (excavation, bedding, testing …)
      belowGround.ts      ITPs 001–014
      aboveGround.ts      ITPs 015–029
      plant.ts            ITPs 030–042
  lib/
    exif.ts               minimal EXIF reader — capture time, GPS, orientation
    images.ts             downscaling, orientation, timestamp burn-in, capture
    format.ts             dates, progress, hold-point blocking, status derivation
    pdf.ts                ITP and register PDF export
  components/
    PlanViewer.tsx        pan / pinch-zoom plan with pin placement
    PhotoCapture.tsx      camera and gallery capture, grid, lightbox
    ui.tsx                icons, sheets, fields, signature pad, toasts
  pages/                  one file per screen
```

**Why these choices.** Dexie's `liveQuery` drives the UI directly, so a photo saved on one
screen appears everywhere without a separate state layer. The EXIF reader is ~180 lines
rather than a dependency, because only three tags are needed. The PDF is drawn with jsPDF
primitives rather than by screenshotting the DOM, so the output is selectable text at a
fixed A4 layout regardless of what the phone was rendering. There is no CSS framework —
the design tokens and components in `styles/app.css` are sized for gloved hands in
daylight.

**Storage.** Records live in IndexedDB, photos as downscaled JPEG data URLs on their own
table so the frequently-read ITP records stay small. Photo size is configurable in
Settings; 1600 px on the long edge is the default and is ample for an ITP record. Back up
regularly — clearing site data deletes everything.

---

## Verified

The full flow is exercised end to end in a real browser (`smoke.mjs`, `smoke2.mjs` with
Playwright against the production build): all 42 templates render in the register, an ITP
is raised, items are signed, a hold point is released with a drawn signature, a plan is
loaded and pinned, a photo is captured and stamped, and the exported PDF is checked to
contain the header block, materials table, schedule, sign-off and the photographic record
page with the pinned plan.
