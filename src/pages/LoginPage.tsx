import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { runtime } from '../lib/runtime'

export function LoginPage() {
  const { signIn, devSignIn, error } = useAuth()
  const [devName, setDevName] = useState('alice')
  const [passcode, setPasscode] = useState('')
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
      {!runtime.identityReady && !runtime.devAuth && (
        <p role="status">Customer sign-in is not configured.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '240px' }}>
        {runtime.devAuth ? (
          <form onSubmit={event => { event.preventDefault(); void devSignIn(devName.trim(), runtime.devPasscode ? passcode : undefined) }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p role="note" style={{ color: 'var(--clr-muted)', fontSize: '0.85rem' }}>
              {runtime.devPasscode
                ? 'Shared dev environment. Test data only, never production.'
                : 'Local development identity. Not available in deployed builds.'}
            </p>
            <label htmlFor="dev-user">Test user</label>
            <input id="dev-user" value={devName} onChange={event => setDevName(event.target.value)}
              autoComplete="off" spellCheck={false} />
            {runtime.devPasscode && <>
              <label htmlFor="dev-passcode">Dev passcode</label>
              <input id="dev-passcode" type="password" value={passcode} onChange={event => setPasscode(event.target.value)}
                autoComplete="current-password" required />
            </>}
            <button type="submit">{runtime.devPasscode ? 'Sign in to dev' : 'Sign in locally'}</button>
          </form>
        ) : (
          <button disabled={!runtime.identityReady} onClick={() => signIn()}>Sign in to Griplock</button>
        )}
      </div>
    </div>
  )
}
