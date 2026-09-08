// Renders a plain typographic wordmark to PNG, used as a stand-in when no real
// logo file is supplied. It is deliberately unstyled type on a transparent
// background — a placeholder to be replaced with the official asset through
// Job details → Head contractor logo.
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? '/tmp/wordmark.png'
const TEXT = process.argv[3] ?? 'BESIX WATPAC'
const [first, ...rest] = TEXT.split(' ')

const browser = await chromium.launch({ executablePath: process.env.ITP_CHROMIUM ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 900, height: 200 }, deviceScaleFactor: 2 })
await page.setContent(`
  <style>
    html, body { margin: 0; background: transparent; }
    .mark {
      display: inline-flex; align-items: baseline; gap: 14px;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      padding: 24px 4px 20px; border-bottom: 6px solid #1b6ca8;
    }
    .a { font-size: 78px; font-weight: 800; letter-spacing: 2px; color: #10263a; }
    .b { font-size: 78px; font-weight: 300; letter-spacing: 6px; color: #1b6ca8; }
  </style>
  <div class="mark"><span class="a">${first}</span><span class="b">${rest.join(' ')}</span></div>
`)
await page.locator('.mark').screenshot({ path: OUT, omitBackground: true })
await browser.close()
console.log('wrote', OUT)
