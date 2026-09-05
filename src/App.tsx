import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useActiveProjectId, useOnline, useProject, useProjects } from './data/store'
import { IconCamera, IconCog, IconHome, IconList, IconPlan } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProjectsPage } from './pages/ProjectsPage'
import { ProjectPage } from './pages/ProjectPage'
import { RegisterPage } from './pages/RegisterPage'
import { ItpPage } from './pages/ItpPage'
import { DrawingsPage } from './pages/DrawingsPage'
import { PhotosPage } from './pages/PhotosPage'
import { SettingsPage } from './pages/SettingsPage'

/** Tabs are project-scoped; without a project the app shows the picker. */
function TabBar({ projectId }: { projectId?: string }) {
  const base = projectId ? `/project/${projectId}` : '/projects'
  const tabs = [
    { to: base, label: 'Job', Icon: IconHome, end: true },
    { to: `${base}/itps`, label: 'ITPs', Icon: IconList },
    { to: `${base}/drawings`, label: 'Plans', Icon: IconPlan },
    { to: `${base}/photos`, label: 'Photos', Icon: IconCamera },
    { to: '/settings', label: 'Settings', Icon: IconCog },
  ]
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink key={label} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
          <Icon />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function Shell() {
  const location = useLocation()
  const navigate = useNavigate()
  const online = useOnline()
  const projects = useProjects()
  const [activeId] = useActiveProjectId()

  // Keep the tab bar pointed at whichever project the current route belongs to.
  const match = /^\/project\/([^/]+)/.exec(location.pathname)
  const routeProjectId = match?.[1]
  const projectId = routeProjectId ?? activeId ?? projects[0]?.id
  const project = useProject(projectId)

  const title = project ? project.name : 'Hydraulic ITP Manager'
  const subtitle = project
    ? [project.projectNumber, project.client].filter(Boolean).join(' · ') || 'Inspection & Test Plans'
    : 'Inspection & Test Plans'

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar__title">
          <h1>{title}</h1>
          <p>
            {subtitle}
            {!online ? ' · offline' : ''}
          </p>
        </div>
        {projects.length > 1 ? (
          <select
            aria-label="Switch job"
            value={projectId ?? ''}
            onChange={(e) => navigate(`/project/${e.target.value}`)}
            style={{ width: 'auto', maxWidth: 190, minHeight: 36 }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      <main className="main">
        {/* Keyed on the route so navigating away clears a failed screen. */}
        <ErrorBoundary key={location.pathname} area="this screen">
          <Routes>
            <Route path="/" element={<Navigate to={projectId ? `/project/${projectId}` : '/projects'} replace />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/project/:projectId" element={<ProjectPage />} />
            <Route path="/project/:projectId/itps" element={<RegisterPage />} />
            <Route path="/project/:projectId/itp/:itpId" element={<ItpPage />} />
            <Route path="/project/:projectId/drawings" element={<DrawingsPage />} />
            <Route path="/project/:projectId/photos" element={<PhotosPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ErrorBoundary>
      </main>

      <TabBar projectId={projectId} />
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
        <NavLink className="btn" to={projectId ? `/project/${projectId}` : '/projects'}>
          Back to the job
        </NavLink>
      </div>
    </div>
  )
}

export function App() {
  return <Shell />
}
