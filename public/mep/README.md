# Axis MEP Design

A browser-based hydraulic and mechanical services design tool: draw cold water,
heated water, sanitary drainage, natural gas, LPG and supply-air networks over a
PDF or image floor plan, and it sizes every pipe and duct as you draw.

Open `public/mep/index.html` from any static server. Once deployed it is at
`https://darrens-axis.github.io/Apps/mep/`. No build step and no sign-in; work
autosaves in the browser and can be saved and opened as `.mep.json` files.

## What it does

| System | Load | Design flow | Sizing | Checks |
| --- | --- | --- | --- | --- |
| Cold / heated water | Loading units per fixture | Q = max(largest outlet, k·√ΣLU), capped at Σ flows (or no diversity) | Smallest bore within the velocity limit, then upsized along the critical path until every outlet has its minimum pressure | Residual pressure at every outlet (friction + fittings allowance + static head), over-pressure, velocity |
| Sanitary drainage | Discharge units (EN 12056-2) | Qww = K·√ΣDU, ≥ largest DU | Smallest DN that carries Qww part-full at the grade (Colebrook–White, kb 1 mm), never below the fixture minimum or the pipe upstream | Capacity, self-cleansing velocity |
| Natural gas / LPG | MJ/h per appliance | max(largest appliance, diversity × connected load), converted at the gas's heating value | Smallest bore within a starting velocity, then upsized along the critical path until every appliance has its minimum inlet pressure (Darcy–Weisbach with the gas's density and viscosity) | Inlet pressure at every appliance, including the stack effect (NG gains ≈ 4.6 Pa/m of rise, LPG loses ≈ 6.6 Pa/m) |
| Supply air | L/s per terminal | Σ terminals | Equal friction: smallest round duct within the Pa/m rate and velocity limit, with an equivalent rectangle (Huebscher) | Index-run pressure, fan external static |

Outputs: on-drawing size labels, pipe & duct schedule, outlet pressures, bill of
materials (lengths by size, tee count), warnings, CSV export, and a printable
design report (Print → Save as PDF).

## Using it

1. **Underlay…** loads a floor plan. For a **PDF**, pick the page and enter the drawing scale from the
   title block (e.g. 1:100). The project scale is then set exactly from the PDF's paper size, so
   no calibration is needed. Check one known dimension before drawing. For an **image**, or a PDF
   without a stated scale, use **Set scale**: click two points a known distance apart. The plan
   is kept in the browser's IndexedDB, not in the autosave, and **Save** embeds it in the
   `.mep.json` so the file opens anywhere.
2. Choose a **System** and place its **Source** (water meter / water heater, sewer connection or AHU).
3. Place **Fixtures** (one fixture can be fed by cold and hot and drain to sewer) and **Air terminals**.
4. **Pipe / duct** draws runs; click on an existing run to tee into it. Esc finishes a run.
5. Select anything to edit it: elevation, supply pressure, airflow, material, locked size, length override, drain grade.
6. **Design criteria** and **Fixtures** set the project's assumptions.

Shortcuts: V select, P pipe, S source, F fixture, T terminal, J junction, Delete, Ctrl+Z / Ctrl+Y. Wheel zooms, drag empty space (or Alt-drag) pans.

pdf.js is not committed: `npm run build` copies the main app's `pdfjs-dist` into
`mep/vendor/`. When serving the folder directly, run `npm run mep:vendor` once, or
it falls back to the jsDelivr CDN.

## Code

- `data.js`: materials, systems, fixture library, default criteria (typical values, to be checked against the job's standard)
- `calc.js`: the solver, with no DOM access. Tested by `npm run test:mep` (`tests/mep-calc.mjs`)
- `underlay.js`: PDF rendering (pdf.js) and the IndexedDB plan store
- `project.js`: project factory and the worked demo
- `app.js`: the SVG editor, panels, reports

## Not done yet

Ring mains and looped networks, hot water circulation and heat loss, gas
pressure tiers (meter → regulator → appliance) and AS/NZS 5601 sizing tables, fire
hydrant/sprinkler hydraulics, stormwater, vent sizing, heat-load calculation,
DWG underlays, multi-level views, 3D, Revit/IFC exchange, fittings take-off
and costing, and multi-user collaboration.

Results are indicative: a competent designer must verify them against AS/NZS 3500
(or the applicable code) before construction.
