import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { runtime } from '../lib/runtime'

export function LoginPage() {
  const { signIn, devSignIn, error } = useAuth()
  const [devName, setDevName] = useState('alice')
  const [passcode, setPasscode] = useState('')
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <img src="/img/logo.png" alt="Griplock" style={{ width: '80px', height: '80px', borderRadius: '50%' }} />
        <h1 id="login-title" style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--clr-accent)' }}>Griplock</h1>
        <p style={{ color: 'var(--clr-muted)', marginBottom: '1rem' }}>Your personal disc golf bag tracker</p>
        {!runtime.devAuth && runtime.identityReady && (
          <div className="login-intro" id="login-help">
            <h2>Your bag starts here</h2>
            <p>Use Google or create a Griplock account with your email. New and returning players start in the same place.</p>
            <ol>
              <li><strong>With Google:</strong> choose &quot;Sign in with Google&quot; on the next page. No separate Griplock password needed.</li>
              <li><strong>With email:</strong> enter the email for your Griplock account, or choose &quot;No account? Create one&quot; to get started.</li>
            </ol>
            <p className="login-provider-note">You&apos;ll continue to Griplock Customers, our sign-in page hosted by Microsoft Entra, then return here to your bag.</p>
          </div>
        )}
        {!runtime.identityReady && !runtime.devAuth && (
          <p role="status">Customer sign-in is not configured.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="login-actions">
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
            <button className="btn btn-primary" disabled={!runtime.identityReady}
              aria-describedby={runtime.identityReady ? 'login-help' : undefined}
              onClick={() => void signIn()}>Sign in to Griplock</button>
          )}
        </div>
        {!runtime.devAuth && runtime.identityReady && (
          <div className="login-questions">
            <details>
              <summary>Can I use my Microsoft account?</summary>
              <p>Not as a Microsoft sign-in with the current options. You can use an Outlook or Hotmail address to create a separate Griplock email account. Use its Griplock password here, not your Microsoft password.</p>
              <p>Work or school Microsoft sign-in is not currently offered. The Microsoft branding identifies the service hosting this page, not an extra sign-in option.</p>
            </details>
            <details>
              <summary>Already signed in with Google?</summary>
              <p>Keep choosing &quot;Sign in with Google&quot; to return to the same Griplock account. Creating an email account instead can give you a separate account and bag.</p>
            </details>
            <details>
              <summary>Missing name on the next screen?</summary>
              <p>The remembered-account picker may show &quot;unknown&quot; when a display name is missing. Check the email below it before continuing. If it isn&apos;t yours, choose &quot;Use another account&quot;.</p>
            </details>
          </div>
        )}
      </section>
    </main>
  )
}
