# Worked example ITPs

Four ITPs filled in end to end on an example job, exported by the app itself —
these are the real output of **Export PDF**, not mock-ups of it.

| File | ITP |
| --- | --- |
| `ITP-015-Sanitary-Plumbing.pdf` | 015 Sanitary Plumbing |
| `ITP-022-Potable-Cold-Water.pdf` | 022 Potable Cold Water |
| `ITP-024-Hot-Water-Service.pdf` | 024 Hot Water Service |
| `ITP-029-Sanitary-Fixtures-and-Tapware.pdf` | 029 Sanitary Fixtures and Tapware |

Each one carries a verified materials table with batch and WaterMark references,
every schedule item signed and dated, hold and witness points released with the
head contractor's signature and inspection reference, recorded test results, a
plan extract with the covered extent highlighted and a location pin, timestamped
photographs including one taken at that pin, and both the installer sign-off and
the head contractor's acceptance.

## What is placeholder, and must be changed

Every page is stamped **EXAMPLE ONLY** — these are demonstrations, not records
of work.

- The **head contractor logo is a plain typographic stand-in**, not the official
  BESIX Watpac asset. Replace it with the real file in the app: Job → Edit →
  Head contractor logo.
- The job name, number, contractor, personnel and inspection reference numbers
  are invented for the example.
- Licence / CP numbers and authority consent numbers are deliberately left
  **blank** rather than filled with invented values.

## Regenerating them

```bash
npm run build
npx vite preview --port 4173 --host 127.0.0.1 &
node tools/make-examples.mjs
```

Set `ITP_CLIENT_LOGO` to the head contractor's official logo file to use it in
place of the stand-in, and `ITP_ONLY=022,024` to rebuild only some of them.
