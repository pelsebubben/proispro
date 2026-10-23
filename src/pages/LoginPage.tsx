import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { runtime } from '../lib/runtime'

export function LoginPage() {
  const { signIn, devSignIn, error } = useAuth()
  const [devName, setDevName] = useState('alice')
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--clr-bg)',
      color: 'var(--clr-text)',
      gap: '1rem',
    }}>
      <img src="/img/logo.png" alt="ProIsPro" style={{ width: '80px', height: '80px', borderRadius: '50%' }} />
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--clr-accent)' }}>ProIsPro</h1>
      <p style={{ color: 'var(--clr-muted)', marginBottom: '1rem' }}>Your personal disc golf bag tracker</p>
      {!runtime.identityReady && (
        <p role="status">Customer sign-in is not configured. Supabase data is not connected.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '240px' }}>
        {runtime.devAuth ? (
          <form onSubmit={event => { event.preventDefault(); void devSignIn(devName.trim()) }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p role="note" style={{ color: 'var(--clr-muted)', fontSize: '0.85rem' }}>
              Local development identity. Not available in deployed builds.
            </p>
            <label htmlFor="dev-user">Test user</label>
            <input id="dev-user" value={devName} onChange={event => setDevName(event.target.value)}
              autoComplete="off" spellCheck={false} />
            <button type="submit">Sign in locally</button>
          </form>
        ) : runtime.dataBackend === 'api' && runtime.identityReady ? (
          <button onClick={() => signIn('google')}>Sign in to Griplock</button>
        ) : <>
        <button
          disabled={!runtime.identityReady}
          onClick={() => signIn('google')}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--clr-accent)',
            color: 'oklch(0.16 0.03 264)',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          🔑 Sign in with Google
        </button>
        <button
          disabled={!runtime.identityReady}
          onClick={() => signIn('github')}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--clr-surface2)',
            color: 'var(--clr-text)',
            border: '1px solid var(--clr-border)',
            borderRadius: 'var(--radius)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.95rem',
          }}
        >
          🐙 Sign in with GitHub
        </button>
        </>}
      </div>
    </div>
  )
}
