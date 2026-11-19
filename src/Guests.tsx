import { useEffect, useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import { accountError } from './firebase'
import { guestDays, tokenPattern } from './guestData'
import { manageGuestShare, readGuest, readGuestConfig, type GuestShare } from './guestStore'
import { GroupNavigation } from './GroupNavigation'
import { GroupHome, People } from './GroupViews'
import { ExpenseCalendar } from './ExpenseCalendar'
import type { AppData } from './model'
import { calculateBalances } from './money'
import { memberLabels } from './people'
import { ActivityFeed, Balances, Expenses } from './screens'
import { CopyField } from './Settings'
import { formatEventTime, Sheet } from './ui'
import { groupViews, type GroupView } from './routing'

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

function guestLocation() {
  const params = new URL(location.href).searchParams
  const view = groupViews.find(item => item === params.get("view")) ?? "overview"
  return { view, focus: params.get("record") ?? undefined }
}

const noEdit = () => {}

export function GuestView({ token, close, retry }: { token: string; close: () => void; retry: () => void }) {
  const [data, setData] = useState<AppData>()
  const [error, setError] = useState('')
  const [{ view, focus }, setLocation] = useState(guestLocation)
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
  useEffect(() => {
    const sync = () => setLocation(guestLocation())
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])
  function go(view: GroupView, focus?: string) {
    const url = new URL(location.href)
    if (view === "overview") url.searchParams.delete("view")
    else url.searchParams.set("view", view)
    if (focus) url.searchParams.set("record", focus)
    else url.searchParams.delete("record")
    if (url.href !== location.href) history.pushState(null, "", url)
    setLocation({ view, focus })
    window.scrollTo({ top: 0 })
  }
  const group = data?.groups[0]
  const labels = memberLabels(data?.members ?? [])
  const nameOf = (id: string) => labels.get(id) ?? 'Unknown member'
  const fullNameOf = (id: string) => data?.members.find(member => member.id === id)?.name ?? nameOf(id)
  const rows = group && data ? { currency: group.currency, expenses: data.expenses, payments: data.payments,
    nameOf, canEdit: false, editExpense: noEdit, editPayment: noEdit } : undefined
  const pairs = data ? calculateBalances(data.expenses, data.payments) : []
  return <div className={group ? "workspace" : undefined}>
    <header className="site-header"><div className="header-inner without-group">
      <span className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally</span>
      {group && <div className="workspace-crumb"><span>Guest view</span><span aria-hidden="true">/</span><strong>{group.name}</strong></div>}
      <button className="text-button guest-exit" type="button" onClick={close}>Exit guest view</button>
    </div></header>
    {group && <aside className="workspace-rail"><span className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally</span>
      <GroupNavigation view={view} go={go} /></aside>}
    <main className={group ? "layout ledger-layout" : "layout"}>
      {error ? <div className="form-stack"><p className="notice danger" role="alert">{error}</p>
        <button className="text-button" onClick={retry}>Use another link</button></div>
        : !group || !rows || !data ? <p className="loading" role="status">Checking guest access&hellip;</p> : <>
          <section className="group-heading"><div className="group-text">
            <h1>{group.name}</h1>
            {group.description && <p>{group.description}</p>}
            <div className="group-actions"><span className="read-only"><Eye size={15} aria-hidden="true" />View only</span>
              <span className="group-meta">{data.members.filter(member => member.active).length} active &middot; {group.currency}</span>
            </div>
          </div></section>
          {view === "overview" && <GroupHome {...rows} pairs={pairs} members={data.members} memberId="" events={data.activity} go={go} />}
          {(view === "expenses" || view === "calendar") && <Expenses key={focus} {...rows} memberId="" members={data.members}
            fullNameOf={fullNameOf} canExport={false} focusTransaction={focus} events={data.activity} calendar={view === "calendar"}
            changeView={calendar => go(calendar ? "calendar" : "expenses")}
            renderCalendar={(expenses, payments) => <ExpenseCalendar {...rows} expenses={expenses} payments={payments} events={data.activity} memberId="" />} />}
          {view === "balances" && <Balances key={focus} {...rows} pairs={pairs} members={data.members} settle={noEdit} focus={focus} />}
          {view === "people" && <People {...rows} pairs={pairs} members={data.members} ownerId={group.ownerMemberId ?? ""}
            memberId="" focus={focus} select={id => go("people", id)} seeBalances={id => go("balances", "member:" + id)} />}
          {view === "activity" && <ActivityFeed events={data.activity} />}
        </>}
    </main>
  </div>
}
