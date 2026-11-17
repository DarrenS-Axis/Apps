# Axis Labour

The SA labour allocation sheet (`Labour 2026.xlsx` in the AXPSA SharePoint site) as a
live, shared web page. Published with the rest of the site at `/Apps/labour/`.

**The Excel workbook stays the master.** The page has no database of its own: it reads
the workbook through Microsoft Graph's Excel API and writes every change straight back
into it. People can keep using Excel (desktop or online) at the same time — both sides
see each other's changes.

## What it does

- The **Labour** sheet as a grid: month / day / weekday header and the notes row frozen
  at the top, names frozen on the left, today outlined in orange, weekends shaded,
  each job coloured by name and leave types (PH, A/LEAVE, RDO, SICK, shutdown, TAFE)
  in fixed colours. Opens scrolled to today.
- **Live:** checks the workbook every 10 seconds; changes made by anyone (in the
  page or in Excel) appear on everyone's screen, and cells someone else changed flash
  orange for a few seconds.
- **Editing:** click or drag to select, type, Enter. The value goes into every selected
  cell. The editor offers the jobs booked around that date, leave types, and
  "repeat for the next N working days" (skipping weekends). Delete clears, Ctrl+C /
  Ctrl+V copy and paste (to and from Excel too), Ctrl+Z undoes. On a phone: tap a cell,
  tap again to edit.
- **Day view:** who is where on a day, grouped by job with head counts, plus who is
  on leave and who has nothing booked.
- **Find person**, **highlight a job** (everything else dims), **current only** (hides
  rows with nothing booked from 4 weeks back to 2 months ahead), jump to a date.
- Every other sheet (e.g. **Project Gannt Chart**) as a plain grid. Formula cells show
  their calculated values and are left for Excel to change.

## Safe editing

- Each save writes only the cells that changed, so it never overwrites anyone else's
  work elsewhere in the sheet.
- Before saving, the page checks the names in the rows being changed still match the
  workbook. If someone inserted or deleted rows in Excel since the page loaded, the
  save is stopped, the sheet reloads, and the person is asked to redo the change — so
  an entry can't land on the wrong person.
- Inserting/deleting rows, colours and formulas are done in Excel; the page picks
  them up on its next check.

## One-time setup (Microsoft 365 admin)

The page signs in with the same Entra ID app registration as Axis QA
(`7485bf02-…`, tenant `e52a9a87-…`). Two things are needed on that registration:

1. **Authentication → Single-page application → Redirect URIs:** add
   `https://darrens-axis.github.io/Apps/labour/`
2. **API permissions:** delegated `Files.ReadWrite.All` (and `User.Read`), with admin
   consent. Axis QA already asks for these.

People also need edit access to the workbook in SharePoint — the page can do nothing
the person couldn't do in Excel.

## Settings

The workbook link, tenant and client id are built in. They can be overridden per
device under the user menu → Connection settings, or for everyone through
`axis-config.json` (`labourFileUrl`, `labourFileName`; the deploy workflow writes it
from the `AXIS_LABOUR_FILE_URL` repository variable). If the sharing link can't be
resolved, the page searches the SharePoint site the link points into for a workbook
named "Labour".

## Files

| File | |
|---|---|
| `index.html`, `styles.css` | page and layout |
| `app.js` | loading, live updates, editing, day view |
| `grid.js` | the canvas grid (only on-screen cells are drawn — the sheet is ~220 × 600) |
| `sheet.js` | header → dates, colours |
| `graph.js` | sign-in (MSAL) and the Excel API |
| `vendor/msal-browser.min.js` | Microsoft's sign-in library |

To try it locally against a stand-in Graph server, serve `public/` and open
`http://localhost:<port>/labour/?graph=http://localhost:4180&token=dev` (the `graph`
and `token` parameters are only honoured on localhost).
