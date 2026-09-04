# Browser smoke tests

End-to-end checks that drive the production build in a real browser with Playwright.
They are deliberately blunt: they walk the paths a plumber actually takes and fail on any
console or page error along the way.

- `smoke-core.mjs` — job creation, the 42-template register, raising an ITP, signing an
  item, hold-point display, materials, sign-off, PDF export, and a desktop viewport pass.
- `smoke-evidence.mjs` — the evidence path: load a plan, raise an ITP against it, sign an
  item with a photo, release a hold point with a drawn signature, drop a pin on the plan,
  sign off and export.

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
| `ITP_PHOTO_FIXTURE` | `/tmp/itp-fixtures/photo.jpg` | Any site photo (evidence test) |

The scripts launch Chromium from `/opt/pw-browsers/chromium`; edit `executablePath` if
your Playwright browsers live elsewhere.

Screenshots are written to `/tmp/itp-shots-core` and `/tmp/itp-shots-evidence`, and the
exported PDFs are saved alongside them for inspection.
