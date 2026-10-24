import { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import type { Tab } from '../lib/navigation'

const TABS: { id: Tab; label: string }[] = [
  { id: 'inventory', label: '💿 Inventory' },
  { id: 'bags', label: '🎒 Bags' },
  { id: 'courses', label: '🗺️ Courses' },
  { id: 'collections', label: '📦 Collections' },
  { id: 'wishlist', label: '⭐ Wishlist' },
  { id: 'forsale', label: '🏷️ For Sale' },
  { id: 'analytics', label: '📊 Analytics' },
]

interface LayoutProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  children: ReactNode
}

export function Layout({ activeTab, onTabChange, children }: LayoutProps) {
  const { user, signOut } = useAuth()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--clr-bg)', color: 'var(--clr-text)' }}>
      {/* Header */}
      <header style={{
        padding: '0.75rem 1rem',
        background: 'var(--clr-surface)',
        borderBottom: '1px solid var(--clr-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <img src="/img/logo.png" alt="" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
          <span style={{ fontWeight: 700, color: 'var(--clr-accent)' }}>ProIsPro</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span title={user?.email} style={{ color: 'var(--clr-muted)', fontSize: '0.85rem' }}>
            {user?.email || user?.name || 'Signed in'}
          </span>
          <button
            onClick={signOut}
            style={{
              padding: '0.35rem 0.75rem',
              background: 'transparent',
              border: '1px solid var(--clr-border)',
              borderRadius: 'var(--radius)',
              color: 'var(--clr-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Tab nav */}
      <nav style={{
        display: 'flex',
        gap: '0',
        background: 'var(--clr-surface)',
        borderBottom: '1px solid var(--clr-border)',
        overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            style={{
              padding: '0.65rem 1rem',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--clr-accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--clr-accent)' : 'var(--clr-muted)',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: '0.85rem',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ padding: '1.5rem 1rem', maxWidth: '1200px', margin: '0 auto' }}>
        {children}
      </main>
    </div>
  )
}
