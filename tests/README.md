# Browser smoke tests

End-to-end checks that drive the production build in a real browser with Playwright.
They are deliberately blunt: they walk the paths a plumber actually takes and fail on any
console or page error along the way.

- `smoke-core.mjs` — job creation, the 42-template register, raising an ITP, signing an
  item, hold-point display, materials, sign-off, PDF export, and a desktop viewport pass.
- `smoke-evidence.mjs` — the evidence path: load a plan, raise an ITP against it, sign an
  item with a photo, release a hold point with a drawn signature, drop a pin on the plan,
  sign off and export.
- `smoke-offline.mjs` — the claim the app rests on: the service worker activates, the app
  reloads with the network cut and keeps its data, and all 42 templates remain available.

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
| `ITP_CHROMIUM` | `/opt/pw-browsers/chromium` | Chromium binary to launch |

The offline suite needs the **production** build served over a secure context (`https`
or a `localhost`/`127.0.0.1` address) — browsers refuse to register a service worker
anywhere else, and `vite dev` does not register one at all.

Screenshots are written to `/tmp/itp-shots-core`, `/tmp/itp-shots-evidence` and
`/tmp/itp-shots-offline`, with the exported PDFs saved alongside them for inspection.

Playwright is deliberately not a dependency — it is a dev tool, not something the app
ships. Install it transiently with `npm install --no-save playwright`.
