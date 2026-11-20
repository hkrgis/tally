import { useEffect, useState, type FormEvent } from 'react'
import { Eye, LogOut, Mail, UserRound } from 'lucide-react'
import googleSignInDark from './assets/google-signin-dark.png'
import googleSignInLight from './assets/google-signin-light.png'
import {
  accountError, accountPasswordLength, checkVerification, firebaseConfigured, isAccountAdmin,
  observeAccount, registerAccount, resendVerification, sendResetEmail, signInAccount, signInWithGoogle, type Account,
} from './firebase'
import { firstName } from './people'
import { nameInitial } from './ui'

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(firebaseConfigured)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!firebaseConfigured) return
    let mounted = true
    let unsubscribe: (() => void) | undefined
    void observeAccount(value => {
      if (mounted) { setAccount(value); setLoading(false) }
    }).then(cleanup => {
      if (mounted) unsubscribe = cleanup
      else cleanup()
    }).catch(issue => {
      if (mounted) { setError(accountError(issue)); setLoading(false) }
    })
    return () => { mounted = false; unsubscribe?.() }
  }, [attempt])
  function retry() {
    setError('')
    setLoading(true)
    setAttempt(current => current + 1)
  }
  return { account, error, loading, retry }
}

type Mode = 'signin' | 'register' | 'reset'

export function AuthCard({ busy, error, run, clearError, viewGuest }: {
  busy: boolean; error: string; run: (work: () => Promise<void>) => void; clearError: () => void; viewGuest: () => void;
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const register = mode === 'register'
  const reset = mode === 'reset'

  function perform(work: () => Promise<void>) {
    setNotice('')
    run(async () => {
      try { await work() } catch (issue) { throw new Error(accountError(issue)) }
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const address = email.trim()
    const password = String(form.get('password') ?? '')
    perform(async () => {
      if (reset) {
        await sendResetEmail(address)
        setNotice('If an account uses that address, we’ll email a reset link.')
      } else if (register) {
        if (password !== form.get('confirmation')) throw new Error('The passwords do not match.')
        await registerAccount(address, password)
      } else await signInAccount(address, password)
    })
  }

  function choose(next: Mode) {
    setNotice('')
    clearError()
    setMode(next)
  }

  return <section className="auth-card" aria-labelledby="auth-heading">
    {!reset && <div className="auth-segments" role="group" aria-label="Account action">
      <button type="button" disabled={busy} aria-pressed={register} onClick={() => choose('register')}>Sign Up</button>
      <button type="button" disabled={busy} aria-pressed={!register} onClick={() => choose('signin')}>Log In</button>
    </div>}
    <h1 id="auth-heading">{reset ? 'Reset your password' : register ? 'Create your account' : 'Log in to Tally'}</h1>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <form key={mode} className="form-stack" onSubmit={submit}>
      <label className="field"><span>Email</span><input type="email" name="email" autoComplete="email" required disabled={busy}
        value={email} onChange={event => setEmail(event.target.value)} /></label>
      {!reset && <label className="field"><span>Password</span>
        <input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
          minLength={register ? accountPasswordLength : undefined} disabled={busy} required />
      </label>}
      {register && <label className="field"><span>Confirm password</span>
        <input name="confirmation" type="password" autoComplete="new-password" minLength={accountPasswordLength} disabled={busy} required />
      </label>}
      <button className="button primary" disabled={busy}>
        {busy ? 'Please wait…' : reset ? 'Send reset link' : register ? 'Create account' : 'Log in'}
      </button>
    </form>
    {!reset && <button className="google-sign-in" type="button" disabled={busy} onClick={() => perform(signInWithGoogle)}
      aria-label="Sign in with Google">
      <img className="google-sign-in-light" src={googleSignInLight} width="180" height="40" alt="" />
      <img className="google-sign-in-dark" src={googleSignInDark} width="180" height="40" alt="" />
    </button>}
    {reset && <button className="text-button" disabled={busy} onClick={() => choose('signin')}>Back to log in</button>}
    {!reset && !register && <button className="text-button" disabled={busy} onClick={() => choose('reset')}>Forgot password?</button>}
    {!reset && <><div className="auth-divider">or</div>
      <button className="button guest-auth" type="button" disabled={busy} onClick={viewGuest}>
        <Eye size={16} aria-hidden="true" />View as guest
      </button>
    </>}
  </section>
}

export function AccountPanel({ account, busy, run, signOut }: {
  account: Account; busy: boolean; run: (work: () => Promise<void>) => void; signOut: () => void;
}) {
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    if (!account.verified) return
    let mounted = true
    void isAccountAdmin(account.id).then(enabled => { if (mounted) setRecovery(enabled) }).catch(() => {})
    return () => { mounted = false }
  }, [account.id, account.verified])

  function perform(work: () => Promise<void>) {
    setNotice('')
    run(async () => {
      try { await work() } catch (issue) { throw new Error(accountError(issue)) }
    })
  }

  return <div className="account-panel">
    <div className="account-profile">
      <span className="avatar tone-neutral" aria-hidden="true">
        {account.name ? nameInitial(account.name) : <UserRound size={22} />}
      </span>
      <div><h3>{firstName(account.name) || account.email}</h3>{account.name && <p>{account.email}</p>}</div>
    </div>
    {!account.verified && <div className="form-stack">
      <p>Open the verification link sent to <strong>{account.email}</strong> before creating or joining groups.</p>
      <button className="button primary" disabled={busy} onClick={() => perform(checkVerification)}>I’ve verified my email</button>
      <button className="text-button" disabled={busy} onClick={() => perform(async () => {
        await resendVerification()
        setNotice('Verification email sent.')
      })}><Mail size={16} />Send again</button>
    </div>}
    {recovery && <form className="settings-section" onSubmit={event => {
      event.preventDefault()
      const recipient = String(new FormData(event.currentTarget).get('recipient') ?? '').trim()
      perform(async () => {
        await sendResetEmail(recipient)
        setNotice('If an account uses that address, we’ll email a reset link.')
      })
    }}>
      <h3>Account recovery</h3>
      <label className="field"><span>User email</span><input name="recipient" type="email" required disabled={busy} /></label>
      <button className="button" disabled={busy}><Mail size={16} />Send reset link</button>
    </form>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <footer className="account-footer">
      <button className="text-button" disabled={busy} onClick={signOut}><LogOut size={16} aria-hidden="true" />Log out</button>
    </footer>
  </div>
}
