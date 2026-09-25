import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ensureBusinessUnits } from './data/db'
import { useActiveProjectId, useOnline, useOutboxCount, useProject, useSettingsState, useVisibleProjects } from './data/store'
import { IconCog, IconFolder, IconHome, IconList, IconPlan } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { StateHomePage } from './pages/StateHomePage'
import { WelcomePage } from './pages/WelcomePage'
import { ProjectPage } from './pages/ProjectPage'
import { RegisterPage } from './pages/RegisterPage'
import { ItpPage } from './pages/ItpPage'
import { DrawingsPage } from './pages/DrawingsPage'
import { PhotosPage } from './pages/PhotosPage'
import { FiredocPage } from './pages/FiredocPage'
import { ReviewdocPage } from './pages/ReviewdocPage'
import { ReportsPage } from './pages/ReportsPage'
import { PlantItemLink, PlantPage, PlantTagLink } from './pages/PlantPage'
import { SettingsPage } from './pages/SettingsPage'
import { applyOrgConfig, isConfigured, lastReport, refreshAccount, startAutoSync } from './sync'
import { SignInGate } from './components/SignInGate'
import { BrandLogo, useBrand } from './components/Brand'
import { warmQrDecoder } from './lib/qr'

/** Tabs are project-scoped and follow the modules the project runs. */
function TabBar({ projectId }: { projectId?: string }) {
  const project = useProject(projectId)
  if (!projectId || !project) {
    return (
      <nav className="tabbar tabbar--4" aria-label="Main">
        <NavLink to="/state" end>
          <IconHome />
          Projects
        </NavLink>
        <NavLink to="/plant">
          <IconTools />
          Plant
        </NavLink>
        <NavLink to="/reports">
          <IconList />
          QA report
        </NavLink>
        <NavLink to="/settings">
          <IconCog />
          Settings
        </NavLink>
      </nav>
    )
  }
  const base = `/project/${projectId}`
  const tabs = [
    { to: base, label: 'Project', Icon: IconHome, end: true },
    ...(project.modules.controldoc ? [{ to: `${base}/itps`, label: 'Controldoc', Icon: IconList }] : []),
    ...(project.modules.firedoc ? [{ to: `${base}/firedoc`, label: 'Firedoc', Icon: IconFire }] : []),
    ...(project.modules.reviewdoc ? [{ to: `${base}/reviewdoc`, label: 'Reviewdoc', Icon: IconReview }] : []),
    { to: `${base}/drawings`, label: 'Plans', Icon: IconPlan },
  ]
  return (
    <nav className={`tabbar tabbar--${tabs.length}`} aria-label="Main">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={label} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
          <Icon />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

const IconFire = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.5.6-2.6 1.4-3.5.3 1 .9 1.6 1.6 2 0-2.5-.4-4.7 1-7z" />
  </svg>
)
const IconTools = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.6-.4-.4-2.6z" />
  </svg>
)
const IconReview = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5h6M9 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2M9 5V4h6v1M9 12l2 2 4-4" />
  </svg>
)

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const { settings, loaded } = useSettingsState()
  const projects = useVisibleProjects()
  const [activeId] = useActiveProjectId()
  const pending = useOutboxCount()

  useEffect(() => {
    void ensureBusinessUnits()
  }, [])
  // The organisation's connection first (it ships with the app), then sync.
  const [orgReady, setOrgReady] = useState(false)
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    const guard = window.setTimeout(() => setOrgReady(true), 4000)
    void applyOrgConfig()
      .catch(() => false)
      .then(async (managed) => {
        if (managed) await refreshAccount().catch(() => undefined)
        window.clearTimeout(guard)
        setOrgReady(true)
        if (!cancelled) stop = startAutoSync()
      })
    return () => {
      cancelled = true
      window.clearTimeout(guard)
      stop?.()
    }
  }, [])
  useEffect(() => warmQrDecoder(), [])

  const match = /^\/project\/([^/]+)/.exec(location.pathname)
  const routeProjectId = match?.[1]
  const projectId = routeProjectId ?? (projects.some((p) => p.id === activeId) ? activeId : undefined)
  // The header names the project only on the project's own screens.
  const project = useProject(routeProjectId)
  const brand = useBrand(routeProjectId)

  // Until a state is chosen there is nothing to show, so every route lands on
  // the welcome screen. Settings stays reachable for the SharePoint setup.
  const needsWelcome = !settings.userName && location.pathname !== '/welcome' && location.pathname !== '/settings'
  // On the organisation's app, a device opens on its shared data only once signed in.
  const needsSignIn = settings.sync.managed && settings.sync.requireSignIn && !settings.sync.devToken && !settings.sync.account

  const title = project ? project.name : settings.state ? `Axis QA · ${settings.state}` : 'Axis QA'
  const subtitle = project
    ? [project.projectNumber, project.client].filter(Boolean).join(' · ') || 'Controldoc · Firedoc · Reviewdoc'
    : settings.role === 'national_qa'
      ? 'National QA'
      : 'Controldoc · Firedoc · Reviewdoc'
  const syncing = isConfigured(settings.sync)
  const onHome = location.pathname === '/state' || location.pathname === '/welcome' || location.pathname.startsWith('/plant')

  return (
    <div className="app">
      <header className="appbar">
        {onHome || needsSignIn ? null : (
          <Link className="iconbtn appbar__jobs" to="/state" aria-label="All projects" title="All projects">
            <IconFolder />
          </Link>
        )}
        {/* Whose app this is, on every screen: the project's business, or the person's own. */}
        {needsSignIn ? (
          <BrandLogo name="Axis" size="sm" />
        ) : (
          <Link to="/state" aria-label={`${brand.name} — home`} style={{ display: 'contents' }}>
            <BrandLogo logo={brand.logo} name={brand.name} size="sm" />
          </Link>
        )}
        <div className="appbar__title">
          <h1>{title}</h1>
          <p>
            {subtitle}
            {!online ? ' · offline' : ''}
          </p>
        </div>
        {syncing && !needsSignIn ? (
          <span
            className={`syncpill ${pending ? 'is-pending' : ''}`}
            title={
              pending
                ? `${pending} changes waiting for SharePoint`
                : `In sync with SharePoint${settings.sync.lastSyncAt ? ` · checked ${new Date(lastReport?.at ?? settings.sync.lastSyncAt).toLocaleTimeString()}` : ''}`
            }
          >
            {pending ? `${pending} ↑` : '✓'}
          </span>
        ) : null}
        {routeProjectId && projects.length > 1 && !needsSignIn ? (
          <select aria-label="Switch project" value={projectId ?? ''} onChange={(e) => navigate(`/project/${e.target.value}`)} style={{ width: 'auto', maxWidth: 170, minHeight: 36 }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
        {/* Project screens have no Settings tab, so the header carries it there. */}
        {routeProjectId && !needsSignIn ? (
          <Link className="iconbtn appbar__jobs" to="/settings" aria-label="Settings" title="Settings">
            <IconCog />
          </Link>
        ) : null}
      </header>

      <main className="main">
        <ErrorBoundary key={location.pathname} area="this screen">
          {!loaded || !orgReady ? null : needsSignIn ? (
            <SignInGate siteUrl={settings.sync.siteUrl} />
          ) : needsWelcome ? (
            // Keep where they were going: a link opened on a new device lands there after the welcome.
            <Navigate to="/welcome" replace state={{ from: `${location.pathname}${location.search}` }} />
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to={settings.userName ? '/state' : '/welcome'} replace />} />
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="/state" element={<StateHomePage />} />
              <Route path="/projects" element={<Navigate to="/state" replace />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
              <Route path="/project/:projectId/itps" element={<RegisterPage />} />
              <Route path="/project/:projectId/itp/:itpId" element={<ItpPage />} />
              <Route path="/project/:projectId/firedoc" element={<FiredocPage />} />
              <Route path="/project/:projectId/reviewdoc" element={<ReviewdocPage />} />
              <Route path="/project/:projectId/drawings" element={<DrawingsPage />} />
              <Route path="/project/:projectId/photos" element={<PhotosPage />} />
              <Route path="/plant" element={<PlantPage />} />
              <Route path="/plant/tag/:plantNo" element={<PlantTagLink />} />
              <Route path="/plant/item/:plantNo" element={<PlantItemLink />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          )}
        </ErrorBoundary>
      </main>

      {/* Settings and the report keep the open project's tabs, so one tap gets back to it. */}
      {location.pathname === '/welcome' || needsSignIn ? null : <TabBar projectId={onHome ? undefined : projectId} />}
    </div>
  )
}

function NotFound() {
  const { projectId } = useParams()
  return (
    <div className="card">
      <div className="card__body">
        <h2 style={{ marginBottom: 6 }}>Page not found</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          That screen does not exist.
        </p>
        <NavLink className="btn" to={projectId ? `/project/${projectId}` : '/state'}>
          Back
        </NavLink>
      </div>
    </div>
  )
}

export function App() {
  return <Shell />
}
