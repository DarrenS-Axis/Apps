# Browser smoke tests

End-to-end checks that drive the production build in a real browser with Playwright.
They are deliberately blunt: they walk the paths a plumber actually takes and fail on any
console or page error along the way.

- `smoke-core.mjs` — job creation, the 42-template register, raising an ITP, signing an
  item, hold-point display, materials, sign-off, PDF export, and a desktop viewport pass.
- `smoke-evidence.mjs` — the evidence path: load a plan, raise an ITP against it, sign an
  item with a photo, release a hold point with a drawn signature, drop a pin on the plan,
  sign off and export.
- `smoke-plan-import.mjs` — the way plans actually arrive: a multi-sheet PDF picked
  through the OS file browser (the same route SharePoint and OneDrive come in by),
  rendered on-device, the right sheet chosen, then linked to an ITP and pinned.
- `smoke-regions.mjs` — highlighting the section an ITP covers: trace a run, box an area,
  confirm panning does not draw, and check both reach the exported PDF and survive a
  reload.
- `smoke-pin-photos.mjs` — photos taken at a plan pin: capture from the pin, the count shown
  on the plan and in the pin list, an existing photo reassigned to a pin, the pin credited
  in the exported PDF, and the evidence surviving the pin's removal.
- `smoke-pinch.mjs` — pinch-zoom driven with CDP touch events, because Playwright's mouse
  cannot produce the two pointers a pinch needs. Asserts the composited plan layer stays
  within a phone GPU's texture limit, that a zero-separation touch does not jump the zoom,
  and that panning survives a finger being lifted mid-pinch.
- `smoke-gesture-recovery.mjs` — the exact sequence reported from site: drag the plan,
  pinch with the fingers released *outside* the viewer, then drag again — repeated over
  several cycles and with one finger lifted before the other. Also flings the plan at zoom
  and asserts it stays on screen, painted, and draggable back.
- `smoke-controldoc-locate.mjs` — a project with no plans: the plan imported from inside an
  ITP and linked to it, a pin dropped with the device's position stamped on the pin and the
  ITP, the pin moved (not duplicated), a second ITP located by signing its first step, and
  the exported PDF read back to confirm it carries the coordinates.
- `smoke-firedoc.mjs` — generates a searchable penetration plan (tags like `F0001-FW-100mm`)
  and an Autopin register CSV, imports the register, runs Autopin and checks it places the
  three tags on the plan where they are and leaves the fourth unplaced; places that one by
  hand, moves an autopinned pin, allocates a profile and completes — which records where the
  device was — then adds a penetration with its plan imported from inside the sheet. Then an
  industry-style drawing (purple disc-and-crosshair symbols, tags `100 FW`, `40 B`,
  `ST 100`, a tag with a dimension line through it, two stacked tags, an incomplete `B`,
  and decoys such as `SPECT 01`): checks the preview reads seven tags plus one flagged
  symbol, every pin lands on its symbol, numbers are allocated, and a re-run adds nothing.
- `smoke-reviewdoc.mjs` — a defect raised with the plan imported from inside the sheet (a
  multi-sheet PDF, one sheet chosen), pinned and the pin moved, the device's position
  recorded (the browser is placed at Liverpool Hospital), every defect shown on the plan
  view, and the QA report exported with the coordinates.
- `smoke-plant.mjs` — the plant register. Builds an .xlsx laid out like the AXIMSRG-03
  register (title block, notes, header on row 17, Excel date serials, `Broken`,
  `DESTROYED`, `Office Only`, `EDinburgh` and `Edinburgh`), imports it and re-imports it
  without duplicates. Then: an item photographed at a job nobody has located asks which
  job; the next item seen there is placed on it without asking; photographed at the
  Beverley yard it is available again. A fake camera feed (a Y4M video of a QR label)
  exercises the live scanner; a PNG of a label, a typed number, an unknown label added
  under its number, and the phone-camera link `#/plant/tag/…` cover the other ways in. A
  stocktake at the yard lists and marks missing what was not scanned. The label sheet,
  plant list and CSV are exported and read back, and the CSV re-imports without moving
  what was seen. The map pins every located item (checked against the store), a pin's
  list opens the item, and *Show on map* draws the drill's trail from the job and back.
  The yard's address lookup and the map tiles (OpenStreetMap) are answered by the test.
- `smoke-people.mjs` — people and notifications, with the test standing in for the Power
  Automate flow. People added by hand and by CSV (lower-cased emails, state column, rows
  with no email skipped); *Send test* reaches one person. A penetration allocated to Joe
  from the sheet's footer: his email fills from his profile, the event is addressed to him
  with the due date, note and a link to the penetration, and *Save* closes the sheet. An
  ITP allocated from the bar pinned at the foot of the ITP page, its event linking to the
  ITP, and its *Save* returning to the register with Joe shown against it. A
  defect raised goes to the NSW people who asked for defects and not to Queensland or to
  people who did not; allocating it to a new name saves them as a person. With no flow set,
  allocating plant offers a pre-written `mailto:` and posts nothing; take back and
  reallocate work. *Allocated to you* opens the item without counting it as a sighting,
  and the event's link opens the penetration.
- `smoke-brand.mjs` — business logos: NZ offered as a business; the SA logo in the app bar
  on the home page and on a project, at the top of the home page and on the unit's section,
  on the ITP screen, and embedded in the exported ITP PDF and a plant label; NSW (no logo
  built in yet) shows the AXIS tile, its trading names match its logos, and a logo uploaded
  in Settings takes over the app bar; national QA sees the ACT, NT, NZ, SA and VIC logos
  and the NZ unit.
- `smoke-sharepoint.mjs` — the Microsoft 365 path, against `mock-graph.mjs` (a stand-in for
  the slice of Graph the sync layer uses): provision the eleven lists, write records (a plant
  item among them) on one device and push them, pull them onto a fresh NSW device, confirm
  a QLD device receives none of them and national QA receives all of them and reports on them.
- `smoke-live.mjs` — everyone on the same data. An organisation config (pointing at
  `mock-graph.mjs`) is served as `axis-config.json`, and devices that were never set up
  connect by themselves: A's project, penetration, plant item and the shared flow URL reach
  SharePoint in about a second with nobody pressing Sync (the lists are created on the way);
  a brand-new device opened on an email link holds nothing state-owned until it says its
  state, then lands on the penetration after the welcome, and a QR link opens the plant
  item it never had; an edit on one phone shows on two others within seconds; Queensland
  receives none of it; and without the test token the app shows *Sign in to Axis QA* and
  nothing else.
- `smoke-offline.mjs` — the claim the app rests on: the service worker activates, the app
  reloads with the network cut and keeps its data, and all 42 templates remain available.

Every suite starts through `helpers.mjs`: the welcome screen (name and state) and a
project under the first business unit, then the project-scoped tabs.

## Running them

```bash
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
npx playwright install chromium      # or point at an existing browser, below
npm run smoke
```

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ITP_BASE_URL` | `http://127.0.0.1:4173` | Where the built app is served |
| `ITP_PLAN_FIXTURE` | `/tmp/itp-fixtures/plan.png` | Any plan image (evidence test) |
| `ITP_BIG_PLAN_FIXTURE` | falls back to `ITP_PLAN_FIXTURE` | A large plan (pinch test) — the zoom bug only bites on a big source image |
| `ITP_PHOTO_FIXTURE` | `/tmp/itp-fixtures/photo.jpg` | Any site photo (evidence test) |
| `ITP_PLAN_PDF` | `/tmp/itp-fixtures/plan.pdf` | Any multi-page PDF (plan import test) |
| `ITP_CHROMIUM` | `/opt/pw-browsers/chromium` | Chromium binary to launch |

The offline suite needs the **production** build served over a secure context (`https`
or a `localhost`/`127.0.0.1` address) — browsers refuse to register a service worker
anywhere else, and `vite dev` does not register one at all.

Screenshots are written to `/tmp/itp-shots-core`, `/tmp/itp-shots-evidence` and
`/tmp/itp-shots-offline`, with the exported PDFs saved alongside them for inspection.

Playwright is deliberately not a dependency — it is a dev tool, not something the app
ships. Install it transiently with `npm install --no-save playwright`.
