import { useState, useEffect, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useDiscs } from './hooks/useDiscs'
import { useBags } from './hooks/useBags'
import { LoginPage } from './pages/LoginPage'
import { Layout } from './components/Layout'

const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const BagsPage = lazy(() => import('./pages/BagsPage').then(m => ({ default: m.BagsPage })))
const CoursesPage = lazy(() => import('./pages/CoursesPage').then(m => ({ default: m.CoursesPage })))
const CollectionsPage = lazy(() => import('./pages/CollectionsPage').then(m => ({ default: m.CollectionsPage })))
const WishlistPage = lazy(() => import('./pages/WishlistPage').then(m => ({ default: m.WishlistPage })))
const ForSalePage = lazy(() => import('./pages/ForSalePage').then(m => ({ default: m.ForSalePage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))

type Tab = 'inventory' | 'bags' | 'courses' | 'collections' | 'wishlist' | 'forsale' | 'analytics'

function FeatureAppShell() {
  const { error: authError } = useAuth()
  const { discs } = useDiscs()
  const { bags } = useBags()
  const [activeTab, setActiveTab] = useState<Tab>('inventory')
  const [dataError, setDataError] = useState('')
  useEffect(() => {
    const listener = (event: Event) => setDataError((event as CustomEvent<string>).detail)
    window.addEventListener('griplock-data-error', listener)
    return () => window.removeEventListener('griplock-data-error', listener)
  }, [])

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {authError && <p role="alert">{authError}</p>}
      {dataError && <div role="alert" style={{ padding: '1rem' }}>
        {dataError} <button onClick={() => setDataError('')}>Dismiss</button>
      </div>}
      <Suspense fallback={<div style={{ padding: '2rem', color: 'var(--clr-muted)', textAlign: 'center' }}>Loading…</div>}>
        {activeTab === 'inventory' && <InventoryPage />}
        {activeTab === 'bags' && <BagsPage />}
        {activeTab === 'courses' && <CoursesPage allDiscs={discs} allBags={bags} />}
        {activeTab === 'collections' && <CollectionsPage allDiscs={discs} />}
        {activeTab === 'wishlist' && <WishlistPage />}
        {activeTab === 'forsale' && <ForSalePage allDiscs={discs} />}
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
