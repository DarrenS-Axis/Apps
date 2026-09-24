#!/usr/bin/env python3
"""
Regenerates src/data/libraries/fireProfiles.ts from the Axis Passive Fire
Rating Schedule workbook.

    python3 tools/import-fire-schedule.py "path/to/Axis Fire Rating Schedule.xlsx" "Rev 7 — 01/01/2025"

Reads the workbook with the standard library only (a workbook is a zip of
XML), groups rows under the six building-element sections, and writes the
typed profile list. Nothing else in the app needs to change when the
schedule is revised.
"""
import sys
import json, zipfile, re
from xml.etree import ElementTree as ET
M='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
path=sys.argv[1] if len(sys.argv) > 1 else "Confidential Axis Fire Rating Schedule 20_03_24 Rev 6.xlsx"
REVISION=sys.argv[2] if len(sys.argv) > 2 else "Rev 6 — 20/03/2024"
z=zipfile.ZipFile(path)
shared=[]
root=ET.fromstring(z.read('xl/sharedStrings.xml'))
for si in root.findall(M+'si'):
    shared.append(''.join(t.text or '' for t in si.iter(M+'t')))
sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
rows={}
for row in sheet.iter(M+'row'):
    cells={}
    for c in row:
        v=c.find(M+'v'); t=c.get('t')
        if v is None: continue
        val=shared[int(v.text)] if t=='s' else (v.text or '')
        val=re.sub(r'\s+',' ',val).strip()
        col=re.match(r'[A-Z]+',c.get('r')).group()
        if val: cells[col]=val
    if cells: rows[int(row.get('r'))]=cells

COLS={'B':'item','C':'profileId','D':'usage','E':'size','F':'treatment','G':'productFrl',
      'H':'element','I':'supplier','J':'product','K':'msds','L':'testReport1','M':'testReport2',
      'N':'reports','P':'notes'}
out=[]; section=None
for r in sorted(rows):
    c=rows[r]
    keys=set(c)
    if c.get('B')=='Passive Fire Rating Schedule': continue
    if c.get('C')=='Axis Profile ID': continue
    if keys=={'B'} and not re.match(r'^\d+$', c['B']):
        section=c['B']; continue
    if 'C' not in c: continue
    rec={v:c.get(k,'') for k,v in COLS.items()}
    rec['section']=section
    out.append(rec)
print('profiles:',len(out))
secs={}
for o in out: secs[o['section']]=secs.get(o['section'],0)+1
for s,n in secs.items(): print(f'  {n:4d}  {s}')
profiles=out

import json, re

def q(s):
    s=(s or '').replace('\\','\\\\').replace("'","\\'")
    return f"'{s}'"
SECTION_KEYS={
 '2hr Conventional Concrete Slabs':'slab2',
 '4hr Conventional Concrete Slabs':'slab4',
 '2hr Composite Steel Slab (Bondek, Kingspan, Slimdeck)':'composite2',
 '2hr Masonry & Plasterboard Walls':'wall2',
 '4hr Masonry Walls':'wall4',
 '2hr 78mm Speed Panel Walls':'speedpanel2',
}
lines=[]
lines.append("""/**
 * Axis Passive Fire Rating Schedule — the approved product for every
 * service, size and building element combination.
 *
 * Generated from "Confidential Axis Fire Rating Schedule 20_03_24 Rev 6.xlsx".
 * This is the schedule Firedoc allocates against: a penetration carries an Axis
 * profile ID, and the profile decides which collar is compliant, to which FRL,
 * with which test report behind it. Site staff and the QA team both work from
 * it, so it is data, not prose — searchable by size, material and element.
 *
 * Do not hand-edit. Re-run `python3 tools/import-fire-schedule.py <xlsx> <revision>`
 * when the schedule is revised.
 */

/** Which building element the profile is tested in. */
export type FireElement = 'slab2' | 'slab4' | 'composite2' | 'wall2' | 'wall4' | 'speedpanel2'

export const FIRE_ELEMENTS: Record<FireElement, string> = {
  slab2: '2hr Conventional Concrete Slabs',
  slab4: '4hr Conventional Concrete Slabs',
  composite2: '2hr Composite Steel Slab (Bondek, Kingspan, Slimdeck)',
  wall2: '2hr Masonry & Plasterboard Walls',
  wall4: '4hr Masonry Walls',
  speedpanel2: '2hr 78mm Speed Panel Walls',
}

export interface FireProfile {
  /** Axis profile ID as printed in the schedule, e.g. "004. 100mm PVC 2hr FLR". */
  id: string
  /** Leading number, for sorting and for matching a shorthand entry. */
  no: string
  element: FireElement
  /** Service material and what it is used for. */
  usage: string
  /** Nominal size as scheduled, e.g. "100mm". */
  size: string
  /** Size in mm where it could be read as a number, for filtering. */
  sizeMm?: number
  treatment: string
  /** FRL the product achieves, with any minimum substrate thickness. */
  productFrl: string
  supplier: string
  product: string
  msds?: string
  testReports: string[]
  reportSummary?: string
  installationNotes?: string
}

export const SCHEDULE_REVISION = '"+REVISION+"'

export const FIRE_PROFILES: FireProfile[] = [""")
for p in profiles:
    reports=[r for r in [p['testReport1'],p['testReport2']] if r]
    size=p['size']
    m=re.match(r'^\s*(\d+)\s*mm', size or '')
    sizemm=f"\n    sizeMm: {m.group(1)}," if m else ''
    msds=f"\n    msds: {q(p['msds'])}," if p['msds'] else ''
    rs=f"\n    reportSummary: {q(p['reports'])}," if p['reports'] else ''
    notes=f"\n    installationNotes: {q(p['notes'])}," if p['notes'] else ''
    no=(p['profileId'].split('.')[0] or '').strip()
    lines.append(f"""  {{
    id: {q(p['profileId'])},
    no: {q(no)},
    element: '{SECTION_KEYS[p['section']]}',
    usage: {q(p['usage'])},
    size: {q(size)},{sizemm}
    treatment: {q(p['treatment'])},
    productFrl: {q(p['productFrl'])},
    supplier: {q(p['supplier'])},
    product: {q(p['product'])},{msds}
    testReports: [{', '.join(q(r) for r in reports)}],{rs}{notes}
  }},""")
lines.append("""]

/** Profiles that fit a service, narrowed as the user picks each field. */
export function matchProfiles(filter: {
  element?: FireElement
  sizeMm?: number
  search?: string
}): FireProfile[] {
  const q = filter.search?.trim().toLowerCase()
  return FIRE_PROFILES.filter((p) => {
    if (filter.element && p.element !== filter.element) return false
    if (filter.sizeMm && p.sizeMm !== filter.sizeMm) return false
    if (q && ![p.id, p.usage, p.product, p.supplier, p.treatment].join(' ').toLowerCase().includes(q)) return false
    return true
  })
}

export function fireProfile(id?: string): FireProfile | undefined {
  if (!id) return undefined
  return FIRE_PROFILES.find((p) => p.id === id || p.no === id)
}

/** Distinct nominal sizes present in the schedule, ascending. */
export const FIRE_SIZES: number[] = [...new Set(FIRE_PROFILES.map((p) => p.sizeMm).filter((n): n is number => !!n))].sort(
  (a, b) => a - b,
)
""")
open('src/data/libraries/fireProfiles.ts','w').write('\n'.join(lines))
print('wrote fireProfiles.ts', len(profiles), 'profiles')
