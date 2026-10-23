import { useState, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { useDiscs } from './hooks/useDiscs'
import { useBags } from './hooks/useBags'
import { LoginPage } from './pages/LoginPage'
import { Layout } from './components/Layout'
import { runtime } from './lib/runtime'

const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })))
const BagsPage = lazy(() => import('./pages/BagsPage').then(m => ({ default: m.BagsPage })))
const CoursesPage = lazy(() => import('./pages/CoursesPage').then(m => ({ default: m.CoursesPage })))
const CollectionsPage = lazy(() => import('./pages/CollectionsPage').then(m => ({ default: m.CollectionsPage })))
const WishlistPage = lazy(() => import('./pages/WishlistPage').then(m => ({ default: m.WishlistPage })))
const ForSalePage = lazy(() => import('./pages/ForSalePage').then(m => ({ default: m.ForSalePage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))

type Tab = 'inventory' | 'bags' | 'courses' | 'collections' | 'wishlist' | 'forsale' | 'analytics'

function LegacyAppShell() {
  const { discs } = useDiscs()
  const { bags } = useBags()
  const [activeTab, setActiveTab] = useState<Tab>('inventory')

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
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
  const { user, isLoading, error, signOut } = useAuth()
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

  if (runtime.dataBackend === 'api') {
    return (
      <main style={{ maxWidth: '640px', margin: '3rem auto', padding: '1rem' }}>
        <h1>Signed in to Griplock</h1>
        <p>{user.email}</p>
        <p role="status">Your identity is connected to Azure. Collection and bag migration is not complete;
          the Supabase-backed screens are not connected in this environment.</p>
        {error && <p role="alert">{error}</p>}
        <button onClick={signOut}>Sign out</button>
      </main>
    )
  }
  return <LegacyAppShell />
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
