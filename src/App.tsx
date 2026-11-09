import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useDiscs } from './hooks/useDiscs'
import { useBags } from './hooks/useBags'
import { LoginPage } from './pages/LoginPage'
import { Layout } from './components/Layout'
import { confirmPlannerNavigation } from './lib/data'
import { runtime } from './lib/runtime'
import { type AppLocation, locationUrl, parseLocation } from './lib/navigation'

const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const BagsPage = lazy(() => import('./pages/BagsPage').then(m => ({ default: m.BagsPage })))
const CoursesPage = lazy(() => import('./pages/CoursesPage').then(m => ({ default: m.CoursesPage })))
const CollectionsPage = lazy(() => import('./pages/CollectionsPage').then(m => ({ default: m.CollectionsPage })))
const WishlistPage = lazy(() => import('./pages/WishlistPage').then(m => ({ default: m.WishlistPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))

function currentUrl() {
  return `${window.location.pathname}${window.location.search}`
}

function FeatureAppShell() {
  const { error: authError } = useAuth()
  const { discs } = useDiscs()
  const { bags } = useBags()
  const [location, setLocation] = useState<AppLocation>(() => parseLocation())
  const withPreviewMode = (url: string) => runtime.mockData ? `${url}${url.includes('?') ? '&' : '?'}mock=1` : url
  const shownUrl = useRef(withPreviewMode(locationUrl(location)))
  const [dataError, setDataError] = useState('')
  useEffect(() => {
    const listener = (event: Event) => setDataError((event as CustomEvent<string>).detail)
    window.addEventListener('griplock-data-error', listener)
    return () => window.removeEventListener('griplock-data-error', listener)
  }, [])

  useEffect(() => {
    // Canonicalise unknown or invalid addresses without adding a history entry; keep any auth fragment.
    if (currentUrl() !== shownUrl.current) {
      window.history.replaceState(window.history.state, '', `${shownUrl.current}${window.location.hash}`)
    }
    const onPopState = () => {
      if (!confirmPlannerNavigation()) {
        window.history.pushState(null, '', shownUrl.current)
        return
      }
      const next = parseLocation()
      shownUrl.current = locationUrl(next)
      setLocation(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (next: AppLocation) => {
    if (!confirmPlannerNavigation()) return
    const url = withPreviewMode(locationUrl(next))
    if (url !== shownUrl.current) window.history.pushState(null, '', url)
    shownUrl.current = url
    setLocation(next)
  }
  const activeTab = location.tab
  const pageKey = shownUrl.current

  return (
    <Layout activeTab={activeTab} onTabChange={tab=>navigate({tab})}>
      {authError && <p role="alert">{authError}</p>}
      {dataError && <div role="alert" style={{ padding: '1rem' }}>
        {dataError} <button onClick={() => setDataError('')}>Dismiss</button>
      </div>}
      <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--clr-muted)', textAlign: 'center' }}>Loading…</div>}>
        {activeTab === 'inventory' && <InventoryPage />}
        {activeTab === 'bags' && <BagsPage key={pageKey} initialBagId={location.bagId}
          onOpenCourses={(bagId,pinId)=>navigate({tab:'courses',bagId,pinId})}/>}
        {activeTab === 'courses' && <CoursesPage key={pageKey} allDiscs={discs} allBags={bags}
          initialBagId={location.bagId} initialPinId={location.pinId}
          onOpenBag={bagId=>navigate({tab:'bags',bagId})}/>}
        {activeTab === 'collections' && <CollectionsPage allDiscs={discs} />}
        {activeTab === 'wishlist' && <WishlistPage />}
        {activeTab === 'analytics' && <AnalyticsPage />}
      </Suspense>
    </Layout>
  )
}

function AppShell() {
  const { user, isLoading } = useAuth()
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--clr-bg)',
        color: 'var(--clr-muted)',
      }}>
        <img src="/img/logo.png" alt="" style={{ width: '60px', borderRadius: '50%' }} />
      </div>
    )
  }

  if (!user) return <LoginPage />

  return <FeatureAppShell />
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
