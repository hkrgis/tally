import { useEffect, useState, type FormEvent } from 'react'
import { ChevronRight, LogOut, Mail, Plus, UserRound } from 'lucide-react'
import googleSignInDark from './assets/google-signin-dark.png'
import googleSignInLight from './assets/google-signin-light.png'
import {
  accountError, accountPasswordLength, checkVerification, firebaseConfigured, isAccountAdmin, listAccountGroups,
  observeAccount, registerAccount, resendVerification, sendResetEmail, signInAccount, signInWithGoogle,
  type Account, type AccountGroup,
} from './firebase'
import { firstName } from './people'
import { nameInitial } from './ui'

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(firebaseConfigured)
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
  }, [])
  return { account, error, loading }
}

type Mode = 'signin' | 'register' | 'reset'

export function AccountPanel({ account, loading, busy, run, newGroup, openGroup, openGroupId, editGroup, signOut }: {
  account: Account | null; loading: boolean; busy: boolean; run: (work: () => Promise<void>) => void;
  newGroup: () => void; openGroup: (id: string) => void; openGroupId?: string; editGroup?: () => void; signOut: () => void;
}) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [recipient, setRecipient] = useState('')
  const [notice, setNotice] = useState('')
  const [groups, setGroups] = useState<AccountGroup[] | null>(null)
  const [admin, setAdmin] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const accountId = account?.verified ? account.id : null

  useEffect(() => {
    if (!accountId) return
    let mounted = true
    setGroups(null)
    setLoadError('')
    setAdmin(false)
    void listAccountGroups(accountId).then(result => {
      if (mounted) setGroups(result)
    }).catch(issue => {
      if (mounted) setLoadError(accountError(issue))
    })
    void isAccountAdmin(accountId).then(result => {
      if (mounted) setAdmin(result)
    }).catch(() => { /* A missing admin record leaves the recovery control unavailable. */ })
    return () => { mounted = false }
  }, [accountId, attempt])

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
      if (mode === 'reset') {
        await sendResetEmail(address)
        setNotice('If an account uses that address, Firebase will email a reset link.')
      } else if (mode === 'register') await registerAccount(address, password)
      else await signInAccount(address, password)
    })
  }

  function choose(next: Mode) {
    setNotice('')
    setMode(next)
  }

  return <div className="account-panel">
    {!loading && account && <div className="account-profile">
      <span className="avatar tone-neutral" aria-hidden="true">
        {account.name ? nameInitial(account.name) : <UserRound size={22} />}
      </span>
      <div>
        <h3>{firstName(account.name) || account.email}</h3>
        {account.name && <p>{account.email}</p>}
      </div>
    </div>}
    {loading ? <p role="status" className="muted">Checking your account…</p> : !account ? <div className="account-auth">
      {mode !== 'reset' && <>
        <button className="google-sign-in" type="button" disabled={busy} onClick={() => perform(signInWithGoogle)}
          aria-label="Sign in with Google">
          <img className="google-sign-in-light" src={googleSignInLight} width="180" height="40" alt="" />
          <img className="google-sign-in-dark" src={googleSignInDark} width="180" height="40" alt="" />
        </button>
        <p className="account-divider">or use email</p>
      </>}
      <form key={mode} className="form-stack" onSubmit={submit}>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" required disabled={busy}
          value={email} onChange={event => setEmail(event.target.value)} /></label>
        {mode !== 'reset' && <label className="field"><span>Password</span>
          <input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={mode === 'register' ? accountPasswordLength : undefined} disabled={busy} required />
        </label>}
        <button className="button primary" disabled={busy}>
          {mode === 'reset' ? 'Send reset link' : mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <div className="inline-actions">
        {mode !== 'signin' && <button className="text-button" disabled={busy} onClick={() => choose('signin')}>Back to sign in</button>}
        {mode === 'signin' && <button className="text-button" disabled={busy} onClick={() => choose('register')}>Create account</button>}
        {mode === 'signin' && <button className="text-button" disabled={busy} onClick={() => choose('reset')}>Forgot password?</button>}
      </div>
    </div> : !account.verified ? <div className="form-stack">
      <p>Verify <strong>{account.email}</strong> using the link in your email before creating a group.</p>
      <button className="button primary" disabled={busy} onClick={() => perform(checkVerification)}>I’ve verified my email</button>
      <button className="text-button" disabled={busy} onClick={() => perform(async () => {
        await resendVerification()
        setNotice('Verification email sent.')
      })}><Mail size={16} />Send again</button>
    </div> : <>
      <section className="account-groups">
        <div className="account-section-head">
          <h3>Your groups</h3>
          <button className="button primary" disabled={busy} onClick={newGroup}><Plus size={16} />New group</button>
        </div>
        {loadError ? <>
          <p className="notice danger" role="alert">{loadError}</p>
          <button className="text-button" onClick={() => setAttempt(value => value + 1)}>Retry</button>
        </> : groups?.length ? <ul className="account-group-list">
          {groups.map(group => <li key={group.id}>
            <button className="account-group-link" disabled={busy} aria-current={group.id === openGroupId ? 'true' : undefined}
              onClick={() => openGroup(group.id)}><span>{group.name}</span><ChevronRight size={16} aria-hidden="true" /></button>
            {group.id === openGroupId && editGroup && <button className="text-button account-group-edit" disabled={busy}
              aria-label={`Edit ${group.name}`} onClick={editGroup}>Edit</button>}
          </li>)}
        </ul> : <p className="muted" role="status">{groups ? 'No groups yet.' : 'Loading your groups…'}</p>}
      </section>
      {admin && <form className="settings-section" onSubmit={event => {
        event.preventDefault()
        perform(async () => {
          await sendResetEmail(recipient.trim())
          setNotice('If an account uses that address, Firebase will email a reset link.')
        })
      }}>
        <h3>Account recovery</h3>
        <label className="field"><span>User email</span><input type="email" required disabled={busy}
          value={recipient} onChange={event => setRecipient(event.target.value)} /></label>
        <button className="button" disabled={busy}><Mail size={16} />Send reset link</button>
      </form>}
    </>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!loading && account && <footer className="account-footer">
      <button className="text-button" disabled={busy} onClick={signOut}><LogOut size={16} aria-hidden="true" />Sign out</button>
    </footer>}
  </div>
}
