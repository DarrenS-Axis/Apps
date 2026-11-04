# Axis MEP Design

A browser-based hydraulic and mechanical services design tool: draw cold water,
heated water, sanitary drainage and supply-air networks over a floor plan, and
it sizes every pipe and duct as you draw.

Open `public/mep/index.html` from any static server. Once deployed it is at
`https://darrens-axis.github.io/Apps/mep/`. No build step and no sign-in; work
autosaves in the browser and can be saved and opened as `.mep.json` files.

## What it does

| System | Load | Design flow | Sizing | Checks |
| --- | --- | --- | --- | --- |
| Cold / heated water | Loading units per fixture | Q = max(largest outlet, k·√ΣLU), capped at Σ flows (or no diversity) | Smallest bore within the velocity limit, then upsized along the critical path until every outlet has its minimum pressure | Residual pressure at every outlet (friction + fittings allowance + static head), over-pressure, velocity |
| Sanitary drainage | Discharge units (EN 12056-2) | Qww = K·√ΣDU, ≥ largest DU | Smallest DN that carries Qww part-full at the grade (Colebrook–White, kb 1 mm), never below the fixture minimum or the pipe upstream | Capacity, self-cleansing velocity |
| Supply air | L/s per terminal | Σ terminals | Equal friction: smallest round duct within the Pa/m rate and velocity limit, with an equivalent rectangle (Huebscher) | Index-run pressure, fan external static |

Outputs: on-drawing size labels, pipe & duct schedule, outlet pressures, bill of
materials (lengths by size, tee count), warnings, CSV export, and a printable
design report (Print → Save as PDF).

## Using it

1. **Underlay…** loads a floor-plan image, then **Set scale**: click two points a known distance apart.
2. Choose a **System** and place its **Source** (water meter / water heater, sewer connection or AHU).
3. Place **Fixtures** (one fixture can be fed by cold and hot and drain to sewer) and **Air terminals**.
4. **Pipe / duct** draws runs; click on an existing run to tee into it. Esc finishes a run.
5. Select anything to edit it: elevation, supply pressure, airflow, material, locked size, length override, drain grade.
6. **Design criteria** and **Fixtures** set the project's assumptions.

Shortcuts: V select, P pipe, S source, F fixture, T terminal, J junction, Delete, Ctrl+Z / Ctrl+Y. Wheel zooms, drag empty space (or Alt-drag) pans.

## Code

- `data.js`: materials, systems, fixture library, default criteria (typical values, to be checked against the job's standard)
- `calc.js`: the solver, with no DOM access. Tested by `npm run test:mep` (`tests/mep-calc.mjs`)
- `project.js`: project factory and the worked demo
- `app.js`: the SVG editor, panels, reports

## Not done yet

Ring mains and looped networks, hot water circulation and heat loss, gas, fire
hydrant/sprinkler hydraulics, stormwater, vent sizing, heat-load calculation,
PDF/DWG underlays, multi-level views, 3D, Revit/IFC exchange, fittings take-off
and costing, and multi-user collaboration.

Results are indicative: a competent designer must verify them against AS/NZS 3500
(or the applicable code) before construction.
