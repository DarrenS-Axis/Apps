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

**Plans from wherever they live.** Drawings arrive as PDFs — usually a multi-sheet set
out of SharePoint, OneDrive or a consultant's transmittal. The plan picker opens the
device's file browser, so any cloud store already signed in on the phone (SharePoint,
OneDrive, Google Drive, Dropbox) is a source, and on a computer you can drag a file in or
paste one. Multi-page PDFs render every sheet and ask which one you want; the drawing
number and revision are read off the title block where they can be determined. Rendering
happens on the device — a drawing is never uploaded anywhere.

**Highlight the section an ITP covers.** Link a drawing to an ITP, then mark it up the way
you would a paper plan with a highlighter. **Highlight run** traces along the pipe run;
**Box area** draws a rectangle around a zone; **Drop pin** marks a single location. Each
mark takes a reference, an optional link to a schedule item, and a note like "110 HDPE run,
IO at grid 3 to boundary trap" — in five colours, so several ITPs or items on the same
drawing stay apart. Everything is drawn onto the plan extract in the exported PDF with a
numbered legend, so the inspector sees exactly what was signed off.

**Photos at a pin.** Tapping the plan drops a pin and opens it, ready for the camera —
photos taken there are tied to that location and stamped with the pin reference, so a print
of the photo still says where it was taken. Pins carrying evidence show a count on the
plan, and an existing photo can be moved onto a pin afterwards from its details. The
exported plan legend credits each pin with its photo count, and the contact sheet names the
pin under every shot. Removing a pin keeps its photos on the ITP; they simply stop being
located on the drawing.

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

**The camera, GPS and offline service worker require a secure context** — `https://` or
`localhost`. Over plain `http` on a LAN address the screens work but the camera button
does not, so test on a phone via the deployed URL rather than `--host`.

### Deploying

`.github/workflows/deploy-pages.yml` builds and publishes to GitHub Pages on every push
to `main` (and, while the app lives there, to the feature branch), or on demand from the
Actions tab. It needs one manual step first:

> Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**

Without that the workflow builds green but never publishes. The site then lives at
`https://<owner>.github.io/<repo>/` — a subpath, which the relative asset paths and hash
routing handle without configuration.

For a one-off with no repository setup, `npm run build` then drag `dist/` onto
[app.netlify.com/drop](https://app.netlify.com/drop).

---

## Using it on site

1. **Settings** — enter your name and initials once. They are stamped into the
   "Initial & Date" column each time you sign an item. Optionally save a signature.
2. **Job** — create the job with its number, stage, client and the person who approves
   ITPs for use. These fill the header block of every exported ITP.
3. **Plans** — add the drawings you are working to. Pick the PDF straight out of
   SharePoint or OneDrive through the file picker; choose the sheet if it is a set.
4. **ITPs → ITP register** — find the ITP for the service you are installing, raise it
   against an area (one per discrete section, as the paper form is issued), and tick the
   drawings it is inspected against.
5. **Work through the schedule** — tap an item to open it, record the result, capture the
   measured value where one is asked for, take photos, and sign. Hold and witness points
   prompt for a release or a notice.
6. **Plans tab** — highlight the run or area this ITP covers, and drop pins where specific
   inspections took place, photographing each one from the pin itself.
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
    planImport.ts         PDF and image plan import, sheet picker, title-block guess
    format.ts             dates, progress, hold-point blocking, status derivation
    pdf.ts                ITP and register PDF export
  components/
    PlanViewer.tsx        pan / pinch-zoom plan, pin placement and region markup
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

**Photos and pins.** A photo names its pin rather than repeating its coordinates, so moving
or relabelling a pin never leaves a photo pointing at a stale location, and deleting a pin
detaches the photo instead of destroying evidence. Dropping a pin creates it immediately
and opens one sheet holding its label, note and camera — an earlier version showed a
placement dialog and then a detail dialog with the same fields twice.

**Zoom limits.** The plan is one CSS-transformed image, so the browser composites it as a
single layer. Mobile GPUs cap textures at 4096-8192 px per side, and an unbounded ceiling
turned a 2600 px plan into a 31200 px layer — around 690 megapixels — which took the tab
down on a phone while desktop tiled its way through it. The maximum zoom is now derived
from the plan's own dimensions, bounded by both edge length and total pixels. Scale 1 is
already one image pixel per CSS pixel, so the ceiling only has to be generous relative to
the fitted view, which for a large plan on a phone is about 0.16.

**Plan markup.** Regions are stored as normalised 0..1 coordinates against the drawing, so
a highlight stays put whatever resolution the plan was rendered at and whatever the device
zoom. They live on the ITP rather than the drawing, because the question being answered is
"which part does *this* ITP cover" — so the same drawing carries different markup for each
ITP raised against it, and duplicating an ITP to a new area starts with a clean plan.

**Plan import.** pdf.js renders drawing PDFs, loaded on demand — it is a megabyte, and
most site sessions never add a drawing. It uses pdf.js's *legacy* build on purpose: the
modern build relies on very recent JavaScript that throws on phones already in use on
site. The title-block guess is deliberately conservative and will leave the drawing number
blank rather than offer one it is unsure of, because a wrong number silently recorded
against an ITP is worse than a field someone has to fill in.

**Offline.** The service worker reads `index.html` on install and precaches exactly the
bundle it references, rather than trusting the HTTP cache, which is evictable. Cache
lookups pass `ignoreVary`: hosts commonly send `Vary: Origin` or `Vary: Accept-Encoding`
and the app's script tags carry `crossorigin`, so without it the shell caches and is then
never found — which looks perfect online and blank on site.

**Storage.** Records live in IndexedDB, photos as downscaled JPEG data URLs on their own
table so the frequently-read ITP records stay small. Photo size is configurable in
Settings; 1600 px on the long edge is the default and is ample for an ITP record. Back up
regularly — clearing site data deletes everything.

---

## Verified

Three Playwright suites drive the production build in a real browser (`npm run smoke`,
see `tests/README.md`):

- **core** — all 42 templates render in the register, an ITP is raised, items signed,
  hold points displayed, materials and sign-off screens exercised, PDF exported, plus a
  desktop viewport pass.
- **evidence** — a plan is loaded and pinned, a photo captured and stamped, a hold point
  released with a drawn signature, and the exported PDF checked for the header block,
  materials table, schedule, sign-off and the photographic record page with the pinned
  plan.
- **plan import** — a multi-sheet PDF is imported, every sheet rendered, the right one
  picked, the drawing number read off the file name (and *not* mistaken for a pipe spec
  like PM64), then linked to an ITP and pinned.
- **regions** — a run is traced and an area boxed on a plan, both are listed, panning does
  not leave stray marks, the markup reaches the exported PDF, and it all survives a reload.
- **pin photos** — photos captured at a pin, the count shown on the plan, an existing photo
  reassigned to a pin, the pin credited in the exported PDF, and the evidence kept when the
  pin is removed.
- **pinch** — real two-finger touch events on a large plan: the composited layer stays
  inside the GPU texture limit however hard it is pinched, two fingers landing on the same
  spot do not jump the zoom, and the plan still pans after one finger is lifted mid-pinch.
- **offline** — the service worker activates, the bundle is genuinely precached (not just
  reachable), the app survives a reload with the network fully cut, and all 42 templates
  stay available with no signal.

All three also pass served from a subpath, which is how GitHub Pages serves it.
