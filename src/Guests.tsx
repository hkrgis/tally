import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Eye, History, LayoutGrid, ReceiptText, Scale } from 'lucide-react'
import { accountError } from './firebase'
import { guestDays, tokenPattern } from './guestData'
import { manageGuestShare, readGuest, readGuestConfig, type GuestShare } from './guestStore'
import { ExpenseCalendar } from './ExpenseCalendar'
import type { AppData } from './model'
import { calculateBalances } from './money'
import { memberLabels } from './people'
import { ActivityFeed, Balances, Expenses, Overview } from './screens'
import { CopyField } from './Settings'
import { formatEventTime, MemberRoster, Sheet } from './ui'
import type { GroupView } from './routing'

export function guestToken(input: string) {
  const value = input.trim()
  const code = value.replace(/^tally-/i, '').toLowerCase()
  if (tokenPattern.test(code)) return code
  try {
    const fragment = new URL(value).hash
    return /^#guest=([a-f0-9]{64})$/i.exec(fragment)?.[1].toLowerCase() ?? ''
  } catch {
    return ''
  }
}

export function GuestEntry({ open, close }: { open: (token: string) => void; close: () => void }) {
  const [error, setError] = useState('')
  return <Sheet title="View as guest" close={close}>
    <form className="form-stack" onSubmit={event => {
      event.preventDefault()
      const token = guestToken(String(new FormData(event.currentTarget).get('code') ?? ''))
      if (token) open(token)
      else setError('Enter a guest code or link. Member invitations require an account.')
    }}>
      <label className="field"><span>Guest code or link</span>
        <input name="code" required autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      {error && <p className="notice danger" role="alert">{error}</p>}
      <button className="button primary">View group</button>
    </form>
  </Sheet>
}

export function GuestSharePanel({ data, revision }: { data: AppData; revision: string }) {
  const group = data.groups[0]
  const [share, setShare] = useState<GuestShare>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    void readGuestConfig(group.id).then(value => { if (active) setShare(value) })
      .catch(issue => { if (active) setError(accountError(issue)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [group.id])
  async function change(action: 'generate' | 'revoke') {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setShare(await manageGuestShare(data, revision, action))
      setNotice(action === 'revoke' ? 'Guest access revoked.' : 'Guest link ready to share.')
    } catch (issue) { setError(accountError(issue)) }
    finally { setBusy(false) }
  }
  const link = share ? new URL(`#guest=${share.token}`, new URL(location.pathname, location.origin)).href : ''
  const available = share && share.expiresAt.toMillis() > Date.now()
  return <div className="form-stack">
    <p>Anyone with the link or code can view the group and its expense details for {guestDays} days.</p>
    {loading && <p role="status">Checking guest access&hellip;</p>}
    {error && <p className="notice danger" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && <div className="inline-actions">
      <button className="button primary" type="button" disabled={busy} onClick={() => void change('generate')}>
        {available ? 'Replace guest link' : 'Generate guest link'}
      </button>
      {share && <button className="text-button negative" type="button" disabled={busy} onClick={() => void change('revoke')}>Revoke guest access</button>}
    </div>}
    {available && <>
      <p className="muted">Expires {formatEventTime(share.expiresAt.toDate().toISOString())}</p>
      <CopyField key={link} value={link} label="Guest link" button="Copy guest link" />
      <CopyField key={share.token} value={`TALLY-${share.token}`} label="Guest code" button="Copy guest code" />
    </>}
  </div>
}

const guestViews = [
  ['overview', 'Overview', LayoutGrid], ['expenses', 'Expenses', ReceiptText], ['calendar', 'Calendar', CalendarDays],
  ['balances', 'Balances', Scale], ['activity', 'Activity', History],
] as const
const noEdit = () => {}

export function GuestView({ token, close, retry }: { token: string; close: () => void; retry: () => void }) {
  const [data, setData] = useState<AppData>()
  const [error, setError] = useState('')
  const [view, setView] = useState<GroupView>('overview')
  const [transaction, setTransaction] = useState<string>()
  const [roster, showRoster] = useState(false)
  const cached = useRef<{ revision: string; data: AppData }>(undefined)
  useEffect(() => {
    let active = true
    let running = false
    let timer: number
    async function refresh() {
      if (!active || running) return
      running = true
      window.clearTimeout(timer)
      try {
        const snapshot = await readGuest(token, cached.current)
        if (!active) return
        if (snapshot.expiry <= Date.now()) throw new Error('This guest link has expired.')
        cached.current = snapshot
        setError('')
        setData(snapshot.data)
        timer = window.setTimeout(() => void refresh(), Math.min(15_000, Math.max(10, snapshot.expiry - Date.now())))
      } catch (issue) {
        if (active) {
          cached.current = undefined
          setData(undefined)
          showRoster(false)
          setError(issue instanceof Error ? issue.message : 'Could not open this guest link.')
        }
      } finally { running = false }
    }
    const onFocus = () => { if (!document.hidden) void refresh() }
    void refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      active = false
      window.clearTimeout(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [token])
  const group = data?.groups[0]
  const labels = memberLabels(data?.members ?? [])
  const nameOf = (id: string) => labels.get(id) ?? 'Unknown member'
  const fullNameOf = (id: string) => data?.members.find(member => member.id === id)?.name ?? nameOf(id)
  const rows = group && data ? { currency: group.currency, expenses: data.expenses, payments: data.payments,
    nameOf, canEdit: false, editExpense: noEdit, editPayment: noEdit } : undefined
  const pairs = data ? calculateBalances(data.expenses, data.payments) : []
  return <>
    <header className="site-header"><div className={`header-inner${group ? '' : ' without-group'}`}>
      <span className="brand">Tally</span>
      {group && <nav className="primary-nav admin-nav" aria-label="Group navigation">
        {guestViews.map(([id, label, Icon]) => <button type="button" key={id} aria-current={view === id ? 'page' : undefined}
          onClick={() => { setView(id); setTransaction(undefined); window.scrollTo(0, 0) }}><Icon size={18} aria-hidden="true" />{label}</button>)}
      </nav>}
      <button className="text-button header-admin guest-exit" type="button" onClick={close}>Exit guest view</button>
    </div></header>
    <main className={`layout${group ? ' ledger-layout' : ''}`}>
      {error ? <div className="form-stack"><p className="notice danger" role="alert">{error}</p>
        <button className="text-button" onClick={retry}>Use another link</button></div>
        : !group || !rows || !data ? <p className="loading" role="status">Checking guest access&hellip;</p> : <>
          <section className="group-heading"><div className="group-text">
            <h1>{group.name}</h1>
            {group.description && <p>{group.description}</p>}
            <div className="group-actions">
              <span className="read-only"><Eye size={15} aria-hidden="true" />View only</span>
              <button className="text-button" onClick={() => showRoster(true)}>Group members</button>
            </div>
          </div></section>
          {view === 'overview' && <Overview {...rows} pairs={pairs} members={data.members} settle={noEdit} events={data.activity}
            openExpenses={() => { setTransaction(undefined); setView('expenses') }}
            openTransaction={id => { setTransaction(id); setView('expenses') }} />}
          {view === 'expenses' && <Expenses {...rows} memberId="" fullNameOf={fullNameOf} canExport={false} focusTransaction={transaction} />}
          {view === 'calendar' && <ExpenseCalendar {...rows} memberId="" />}
          {view === 'balances' && <Balances {...rows} pairs={pairs} settle={noEdit} />}
          {view === 'activity' && <ActivityFeed events={data.activity} />}
        </>}
    </main>
    {roster && data && <Sheet title="Group members" close={() => showRoster(false)}>
      <MemberRoster members={data.members} nameOf={nameOf} />
    </Sheet>}
  </>
}
