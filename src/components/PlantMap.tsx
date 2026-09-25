import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { depotReach } from '../data/plant'
import { PLANT_STATUS_LABEL, PLANT_STATUSES, type Depot, type PlantItem, type PlantStatus } from '../data/types'
import { formatDateTime, relativeTime } from '../lib/format'

/**
 * Where the plant is, on a map: each item at the position of its last photo
 * or scan, the yards and offices with the distance that counts as "there",
 * and — for one chosen item — the trail of everywhere it has been seen.
 *
 * Leaflet and the OpenStreetMap tiles load only when the map is opened. With
 * no signal the tiles stay grey but every pin is still placed, since the
 * positions live on the device.
 */

export const STATUS_COLOUR: Record<PlantStatus, string> = {
  available: '#15803d',
  on_site: '#0369a1',
  out_of_service: '#a16207',
  missing: '#c2410c',
  disposed: '#6b8095',
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Items within this many screen pixels share a pin, so a yard of 400 tools stays readable. */
const CLUSTER_PX = 34
const POPUP_LIMIT = 40

type Located = PlantItem & { lat: number; lng: number }

interface Cluster {
  items: Located[]
  lat: number
  lng: number
}

function clusterAt(map: Leaflet.Map, items: Located[]): Cluster[] {
  const out: (Cluster & { p: Leaflet.Point })[] = []
  for (const item of items) {
    const p = map.latLngToLayerPoint([item.lat, item.lng])
    const hit = out.find((c) => c.p.distanceTo(p) < CLUSTER_PX)
    if (hit) hit.items.push(item)
    else out.push({ items: [item], lat: item.lat, lng: item.lng, p })
  }
  // Each pin sits at the middle of what it holds.
  for (const c of out) {
    c.lat = c.items.reduce((s, i) => s + i.lat, 0) / c.items.length
    c.lng = c.items.reduce((s, i) => s + i.lng, 0) / c.items.length
  }
  return out
}

function pinHtml(c: Cluster): { html: string; size: number } {
  const counts = new Map<PlantStatus, number>()
  for (const i of c.items) counts.set(i.status, (counts.get(i.status) ?? 0) + 1)
  const main = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  if (c.items.length === 1) {
    const i = c.items[0]
    return {
      html: `<span class="plantpin plantpin--one" style="--pin:${STATUS_COLOUR[i.status]}" data-count="1"><span>${esc(i.plantNo)}</span></span>`,
      size: 22,
    }
  }
  // A ring split by status, so a mixed pin shows what is in it at a glance.
  let at = 0
  const stops = PLANT_STATUSES.filter((s) => counts.get(s)).map((s) => {
    const from = at
    at += (counts.get(s)! / c.items.length) * 360
    return `${STATUS_COLOUR[s]} ${from}deg ${at}deg`
  })
  const size = c.items.length >= 100 ? 46 : c.items.length >= 10 ? 38 : 32
  return {
    html: `<span class="plantpin plantpin--many" style="--pin:${STATUS_COLOUR[main]};--ring:conic-gradient(${stops.join(',')});width:${size}px;height:${size}px" data-count="${c.items.length}"><b>${c.items.length}</b></span>`,
    size,
  }
}

function popupHtml(c: Cluster, spread: boolean): string {
  const rows = c.items
    .slice()
    .sort((a, b) => a.plantNo.localeCompare(b.plantNo))
    .slice(0, POPUP_LIMIT)
    .map(
      (i) =>
        `<button type="button" class="mappop__item" data-plant="${esc(i.id)}"><span class="mappop__dot" style="background:${STATUS_COLOUR[i.status]}"></span><span><b>${esc(i.plantNo)}</b> ${esc(i.type)}<br><small>${esc(PLANT_STATUS_LABEL[i.status])}${i.location ? ` · ${esc(i.location)}` : ''}${i.seenAt ? ` · seen ${esc(relativeTime(i.seenAt))}` : ''}</small></span></button>`,
    )
    .join('')
  const more = c.items.length > POPUP_LIMIT ? `<p class="mappop__more">+ ${c.items.length - POPUP_LIMIT} more — narrow the list with the filters above.</p>` : ''
  const zoom = spread ? `<button type="button" class="mappop__zoom" data-zoom="1">Zoom in to separate them</button>` : ''
  return `<div class="mappop"><p class="mappop__head">${c.items.length} item${c.items.length === 1 ? '' : 's'} here</p>${zoom}<div class="mappop__list">${rows}</div>${more}</div>`
}

export function PlantMap({
  items,
  depots,
  focus,
  onOpen,
  onClearFocus,
  height = 460,
}: {
  items: PlantItem[]
  depots: Depot[]
  /** An item whose movement trail is drawn. */
  focus?: PlantItem
  onOpen: (id: string) => void
  onClearFocus?: () => void
  height?: number
}) {
  const el = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<{ L: typeof Leaflet; map: Leaflet.Map; pins: Leaflet.LayerGroup; depots: Leaflet.LayerGroup; trail: Leaflet.LayerGroup } | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  const located = useMemo(() => items.filter((i): i is Located => i.lat !== undefined && i.lng !== undefined), [items])
  const fitted = useRef(false)

  // Leaflet, once.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const L = (await import('leaflet')).default
        await import('leaflet/dist/leaflet.css')
        if (cancelled || !el.current) return
        const map = L.map(el.current, { zoomControl: true, attributionControl: true, center: [-34.9, 138.6], zoom: 10 })
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        }).addTo(map)
        const layers = { depots: L.layerGroup().addTo(map), trail: L.layerGroup().addTo(map), pins: L.layerGroup().addTo(map) }
        mapRef.current = { L, map, ...layers }
        setReady(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The map could not load.')
      }
    })()
    return () => {
      cancelled = true
      mapRef.current?.map.remove()
      mapRef.current = null
    }
  }, [])

  // Yards and offices.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    m.depots.clearLayers()
    for (const d of depots) {
      if (d.lat === undefined || d.lng === undefined) continue
      m.L.circle([d.lat, d.lng], { radius: depotReach(d), color: '#0f2436', weight: 1.5, dashArray: '5 5', fillOpacity: 0.05 }).addTo(m.depots)
      m.L.marker([d.lat, d.lng], {
        icon: m.L.divIcon({ className: '', html: `<span class="depotpin" title="${esc(d.name)}">⌂ ${esc(d.name)}</span>`, iconSize: [0, 0] }),
        interactive: false,
        keyboard: false,
      }).addTo(m.depots)
    }
  }, [ready, depots])

  // Item pins, regrouped at every zoom so close items part as you zoom in.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    const draw = () => {
      m.pins.clearLayers()
      for (const c of clusterAt(m.map, located)) {
        const { html, size } = pinHtml(c)
        const marker = m.L.marker([c.lat, c.lng], {
          icon: m.L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
          title: c.items.length === 1 ? `${c.items[0].plantNo} ${c.items[0].type}` : `${c.items.length} items`,
          riseOnHover: true,
        })
        const spread = c.items.some((i) => Math.abs(i.lat - c.items[0].lat) > 2e-5 || Math.abs(i.lng - c.items[0].lng) > 2e-5) && m.map.getZoom() < 18
        marker.bindPopup(popupHtml(c, spread), { maxWidth: 300, minWidth: 220, autoPanPadding: [12, 12] })
        marker.on('popupopen', (e) => {
          const root = (e as Leaflet.PopupEvent).popup.getElement()
          root?.querySelectorAll<HTMLButtonElement>('[data-plant]').forEach((b) => b.addEventListener('click', () => onOpenRef.current(b.dataset.plant!)))
          root?.querySelector<HTMLButtonElement>('[data-zoom]')?.addEventListener('click', () => {
            m.map.closePopup()
            m.map.fitBounds(m.L.latLngBounds(c.items.map((i) => [i.lat, i.lng] as [number, number])).pad(0.4), { maxZoom: 19 })
          })
        })
        marker.addTo(m.pins)
      }
    }
    draw()
    m.map.on('zoomend', draw)
    return () => {
      m.map.off('zoomend', draw)
    }
  }, [ready, located])

  // Frame everything once, when there is something to frame.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m || fitted.current || focus) return
    const points: [number, number][] = [
      ...located.map((i) => [i.lat, i.lng] as [number, number]),
      ...depots.filter((d) => d.lat !== undefined && d.lng !== undefined).map((d) => [d.lat!, d.lng!] as [number, number]),
    ]
    if (!points.length) return
    fitted.current = true
    if (points.length === 1) m.map.setView(points[0], 15)
    else m.map.fitBounds(m.L.latLngBounds(points).pad(0.15), { maxZoom: 16 })
  }, [ready, located, depots, focus])

  // One item's trail: every sighting in order.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    m.trail.clearLayers()
    if (!focus) return
    const stops = focus.history.filter((h) => h.lat !== undefined && h.lng !== undefined)
    if (!stops.length) return
    const line = stops.map((h) => [h.lat!, h.lng!] as [number, number])
    m.L.polyline(line, { color: '#0f7ac2', weight: 3, dashArray: '6 6', className: 'plantmap-trail' }).addTo(m.trail)
    stops.forEach((h, n) => {
      m.L.circleMarker([h.lat!, h.lng!], { radius: n === stops.length - 1 ? 7 : 5, color: '#fff', weight: 2, fillColor: STATUS_COLOUR[h.status], fillOpacity: 1 })
        .bindTooltip(`${formatDateTime(h.at)} · ${PLANT_STATUS_LABEL[h.status]}${h.location ? ` · ${h.location}` : ''}${h.by ? ` · ${h.by}` : ''}`)
        .addTo(m.trail)
    })
    fitted.current = true
    if (line.length === 1) m.map.setView(line[0], 16)
    else m.map.fitBounds(m.L.latLngBounds(line).pad(0.25), { maxZoom: 17 })
  }, [ready, focus])

  const counts = useMemo(() => {
    const c = new Map<PlantStatus, number>()
    for (const i of located) c.set(i.status, (c.get(i.status) ?? 0) + 1)
    return c
  }, [located])

  return (
    <div className="stack" style={{ gap: 8 }}>
      {focus ? (
        <div className="banner banner--info">
          <span style={{ flex: 1 }}>
            Trail of <strong>{focus.plantNo}</strong> {focus.type} — {focus.history.filter((h) => h.lat !== undefined).length} located sightings, oldest to newest.
          </span>
          {onClearFocus ? (
            <button className="btn btn--ghost btn--sm" type="button" onClick={onClearFocus}>
              Show all
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="plantmap" ref={el} style={{ height }} role="region" aria-label="Plant map">
        {!ready && !error ? <span className="plantmap__msg">Loading the map…</span> : null}
        {error ? <span className="plantmap__msg">{error}</span> : null}
      </div>
      <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
        {PLANT_STATUSES.filter((s) => counts.get(s)).map((s) => (
          <span key={s} className="row" style={{ gap: 5, alignItems: 'center' }}>
            <span className="mappop__dot" style={{ background: STATUS_COLOUR[s] }} />
            {PLANT_STATUS_LABEL[s]} {counts.get(s)}
          </span>
        ))}
        <span className="muted">
          {located.length} of {items.length} shown{items.length > located.length ? ` — ${items.length - located.length} not yet photographed or scanned` : ''}
        </span>
      </div>
    </div>
  )
}
