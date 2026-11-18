import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, CalendarDays, ChevronRight, CircleAlert, CircleCheck, History, KeyRound, LayoutGrid, LockKeyhole, Plus, ReceiptText, Settings2, UsersRound } from 'lucide-react'
import { ExpenseCalendar } from './ExpenseCalendar'
import { ExpenseForm, groupCurrencyLocked, GroupForm, MemberForm, PaymentForm, SessionForm, SessionsList } from './forms'
import { type Expense, type Group, type Member, type Payment, type SportsSession } from './model'
import { calculateBalances, type PairBalance } from './money'
import { ActivityFeed, Balances, Expenses, Overview } from './screens'
import { Admin, Settings, useSettingsRequest, type Theme } from './Settings'
import { Avatar, Empty, Sheet } from './ui'
import { useLedger } from './useLedger'
import { maxPasswordLength, type GroupEntry } from './vault'

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'expenses', label: 'Expenses', icon: ReceiptText },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'balances', label: 'Balances', icon: ArrowLeftRight },
  { id: 'activity', label: 'Activity', icon: History },
] as const

type View = typeof views[number]['id']
type Panel =
  | { kind: 'settings' | 'admin' | 'members' | 'sessions' }
  | { kind: 'unlock'; entry: GroupEntry }
  | { kind: 'group'; group?: Group }
  | { kind: 'member'; member?: Member }
  | { kind: 'expense'; expense?: Expense; session?: SportsSession; date?: string }
  | { kind: 'payment'; payment?: Payment; pair?: PairBalance }
  | { kind: 'session'; session?: SportsSession }

function readPref(name: string) {
  try { return localStorage.getItem(`tally:${name}`) ?? '' } catch { return '' }
}
function writePref(name: string, value: string) {
  try { localStorage.setItem(`tally:${name}`, value) } catch { /* Preferences are optional. */ }
}
function currentView(): View {
  return views.find(view => `#${view.id}` === window.location.hash)?.id ?? 'overview'
}
function upsert<T extends { id: string }>(records: T[], record: T) {
  const index = records.findIndex(existing => existing.id === record.id)
  if (index === -1) records.push(record)
  else records[index] = record
}

function UnlockForm({ name, busy, unlock }: { name: string; busy: boolean; unlock: (password: string) => void }) {
  const password = useRef<HTMLInputElement>(null)
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault()
    const value = password.current?.value ?? ''
    if (password.current) password.current.value = ''
    unlock(value)
  }}>
    <label className="field"><span>Group password</span>
      <input ref={password} type="password" autoComplete="off" aria-label={`Group password for ${name}`} required
        maxLength={maxPasswordLength} disabled={busy} />
    </label>
    <button className="button primary" disabled={busy}><LockKeyhole size={17} />{busy ? 'Unlocking…' : 'Unlock group'}</button>
  </form>
}

export default function App() {
  const ledger = useLedger()
  const { data } = ledger
  const request = useSettingsRequest()
  const [view, setView] = useState<View>('overview')
  const [showDirectory, setShowDirectory] = useState(false)
  const [identity, setIdentity] = useState('')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const value = readPref('theme')
    return value === 'dark' || value === 'light' ? value : 'system'
  })
  const [message, setMessage] = useState('')
  const group = data?.groups[0]
  const members = data?.members ?? []
  const activeMembers = members.filter(member => member.active)
  const memberId = members.find(member => member.id === identity)?.id ?? activeMembers[0]?.id ?? members[0]?.id ?? ''
  const expenses = data?.expenses ?? []
  const payments = data?.payments ?? []
  const sessions = data?.sessions ?? []
  const pairs = calculateBalances(expenses, payments)
  const nameOf = (id: string) => members.find(member => member.id === id)?.name ?? 'Unknown member'
  const canEdit = Boolean(ledger.editor && group && !group.archived)
  const busy = request.busy || ledger.working

  useEffect(() => {
    const onHash = () => setView(currentView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      const dark = theme === 'dark' || (theme === 'system' && query.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191720' : '#f8f7f4')
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [theme])

  function go(next: View) {
    if (window.location.hash !== `#${next}`) window.location.hash = next
    setView(next)
    window.scrollTo({ top: 0 })
  }
  function open(next: Panel | null) {
    request.clearError()
    setPanel(next)
  }
  function exitGroup(showGroups: boolean) {
    ledger.lock()
    setIdentity('')
    setShowDirectory(showGroups)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setView('overview')
    open(null)
    window.scrollTo({ top: 0 })
  }
  function startExpense(date?: string) {
    if (!canEdit) return
    open(activeMembers.length ? { kind: 'expense', date } : { kind: 'members' })
  }
  function changed(next: Panel | null = null) {
    open(next)
    setMessage('Saved to draft.')
  }
  async function saveGroup(record: Group, password: string, original?: Group) {
    if (original) {
      await ledger.change(draft => upsert(draft.groups, record), {
        groupId: record.id, entityId: record.id, entity: 'group', title: record.name,
        action: record.archived === original.archived ? 'updated' : record.archived ? 'archived' : 'restored',
      }, password)
      changed({ kind: 'admin' })
    } else {
      await ledger.createGroup(record, password)
      setShowDirectory(true)
      go('overview')
      changed({ kind: 'members' })
    }
  }
  async function saveMember(record: Member, original?: Member) {
    await ledger.change(draft => upsert(draft.members, record), {
      groupId: record.groupId, entityId: record.id, entity: 'member', title: record.name,
      action: !original ? 'created' : record.active === original.active ? 'updated' : record.active ? 'restored' : 'archived',
    })
    changed({ kind: 'members' })
  }
  async function saveExpense(record: Expense, original?: Expense) {
    await ledger.change(draft => upsert(draft.expenses, record), {
      groupId: record.groupId, entityId: record.id, entity: 'expense', title: record.description, action: original ? 'updated' : 'created',
    })
    changed()
  }
  async function removeExpense(record: Expense) {
    await ledger.change(draft => { draft.expenses = draft.expenses.filter(expense => expense.id !== record.id) }, {
      groupId: record.groupId, entityId: record.id, entity: 'expense', title: record.description, action: 'removed',
    })
    changed()
  }
  const paymentTitle = (record: Payment) => `${nameOf(record.from)} → ${nameOf(record.to)}`.slice(0, 100)
  async function savePayment(record: Payment, original?: Payment) {
    await ledger.change(draft => upsert(draft.payments, record), {
      groupId: record.groupId, entityId: record.id, entity: 'payment', title: paymentTitle(record), action: original ? 'updated' : 'created',
    })
    changed()
  }
  async function removePayment(record: Payment) {
    await ledger.change(draft => { draft.payments = draft.payments.filter(payment => payment.id !== record.id) }, {
      groupId: record.groupId, entityId: record.id, entity: 'payment', title: paymentTitle(record), action: 'removed',
    })
    changed()
  }
  async function saveSession(record: SportsSession, original?: SportsSession) {
    await ledger.change(draft => upsert(draft.sessions, record), {
      groupId: record.groupId, entityId: record.id, entity: 'session', title: record.name,
      action: !original ? 'created' : record.active === original.active ? 'updated' : record.active ? 'restored' : 'archived',
    })
    changed({ kind: 'sessions' })
  }

  const editExpense = (expense: Expense) => open({ kind: 'expense', expense })
  const editPayment = (payment: Payment) => open({ kind: 'payment', payment })
  const close = () => open(null)
  const requestError = request.error && <p className="notice danger settings-error" role="alert">{request.error}</p>
  function renderPanel() {
    if (!panel) return null
    if (panel.kind === 'settings') return <Sheet key="settings" title="Settings" close={close} busy={busy}>
      {requestError}
      <Settings theme={theme} changeTheme={value => { setTheme(value); writePref('theme', value) }}
        busy={busy} refresh={() => request.run(() => ledger.refresh(ledger.publication ?? undefined))} />
    </Sheet>
    if (panel.kind === 'admin') return <Sheet key="admin" title={ledger.editor ? 'Admin workspace' : 'Admin access'} close={close} busy={busy}>
      {requestError}
      {ledger.publication && <p className="notice settings-error" role="status">Committed to GitHub. The public site updates after deployment.</p>}
      <Admin ledger={ledger} group={group} busy={busy} run={request.run}
        groupForm={value => open({ kind: 'group', group: value })} members={() => open({ kind: 'members' })} />
    </Sheet>
    if (panel.kind === 'unlock') {
      const { entry } = panel
      return <Sheet key={entry.id} title={`Unlock ${entry.name}`} description="Enter the password shared by your group organiser." close={close} busy={busy}>
        {requestError}
        <UnlockForm name={entry.name} busy={busy} unlock={password => request.run(async () => {
          await ledger.unlock(entry, password)
          setIdentity('')
          go('overview')
          close()
          window.requestAnimationFrame(() => document.getElementById('group-title')?.focus())
        })} />
      </Sheet>
    }
    if (panel.kind === 'group' && ledger.editor && (!panel.group || data)) return <Sheet key="group" title={panel.group ? 'Edit group' : 'New group'} close={close} busy={busy}>
      <GroupForm group={panel.group} currencyLocked={Boolean(panel.group && data && groupCurrencyLocked(data, panel.group.id))}
        save={(record, password) => saveGroup(record, password, panel.group)} />
    </Sheet>
    if (!group) return null
    if (panel.kind === 'sessions') return <Sheet key="sessions" title="Sports sessions" close={close} description="Confirm who attended before recording each court fee.">
      <SessionsList sessions={sessions} expenses={expenses} currency={group.currency}
        edit={canEdit ? session => open({ kind: 'session', session }) : undefined}
        record={canEdit ? (session, date) => open({ kind: 'expense', session, date }) : undefined}
        create={canEdit && activeMembers.length ? () => open({ kind: 'session' }) : undefined} />
      {canEdit && activeMembers.length === 0 && <button className="button sheet-next" onClick={() => open({ kind: 'members' })}>Add group members</button>}
    </Sheet>
    if (panel.kind === 'members') return <Sheet key="members" title="Group members" close={close}>
      <div className="form-stack">
        {members.length > 0 && <div className="list-surface">{members.map((member, index) => <div className="roster-row" key={member.id}>
          <Avatar member={member} index={index} /><span><strong>{member.name}</strong>{!member.active && <small>Inactive</small>}</span>
          {canEdit && <button className="text-button" aria-label={`Edit ${member.name}`} onClick={() => open({ kind: 'member', member })}>Edit</button>}
        </div>)}</div>}
        {!members.length && <p className="muted">This group has no members yet.</p>}
        {canEdit && <button className="button primary" onClick={() => open({ kind: 'member' })}><Plus size={17} />Add member</button>}
      </div>
    </Sheet>
    if (!canEdit) return null
    if (panel.kind === 'member') return <Sheet key="member" title={panel.member ? 'Edit member' : 'Add member'} close={close} busy={busy}>
      <MemberForm group={group} member={panel.member} save={record => saveMember(record, panel.member)} />
    </Sheet>
    if (panel.kind === 'expense') {
      const { expense, session, date } = panel
      return <Sheet key="expense" title={expense ? 'Edit expense' : session ? 'Record sports session' : 'Add expense'} close={close} busy={busy}>
        <ExpenseForm group={group} members={members} memberId={memberId} expense={expense} session={session} occurrenceDate={date}
          save={record => saveExpense(record, expense)} remove={expense ? () => removeExpense(expense) : undefined} />
      </Sheet>
    }
    if (panel.kind === 'payment') {
      const { payment, pair } = panel
      return <Sheet key="payment" title={payment ? 'Edit payment' : 'Record payment'} close={close} busy={busy}>
        <PaymentForm group={group} members={members} expenses={expenses} payments={payments} pair={pair} payment={payment}
          save={record => savePayment(record, payment)} remove={payment ? () => removePayment(payment) : undefined} />
      </Sheet>
    }
    if (panel.kind === 'session') return <Sheet key="session" title={panel.session ? 'Edit sports schedule' : 'New sports schedule'} close={close} busy={busy}>
      <SessionForm group={group} members={members} session={panel.session} save={record => saveSession(record, panel.session)} />
    </Sheet>
    return null
  }

  const screenProps = group && { currency: group.currency, nameOf, expenses, payments, canEdit, editExpense, editPayment }
  const visibleGroups = [...(ledger.directory?.groups ?? [])].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
  const showStatus = showDirectory || group || ledger.editor
  return <>
    <a className="skip-link" href="#page-content" onClick={event => {
      event.preventDefault()
      document.getElementById('page-content')?.focus()
    }}>Skip to content</a>
    <header className="site-header">
      <div className={`header-inner${group ? '' : ' without-group'}`}>
        <a className="brand" href="#" onClick={event => { event.preventDefault(); exitGroup(false) }} aria-label="Tally home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Tally<span className="brand-period">.</span></span>
        </a>
        {group && <nav className="primary-nav" aria-label="Main navigation">
          {views.map(({ id, label, icon: Icon }) => <a href={`#${id}`} key={id} aria-current={view === id ? 'page' : undefined}
            onClick={event => { event.preventDefault(); go(id) }}>
            <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
          </a>)}
        </nav>}
        <div className="header-actions">
          <button className="button header-admin" onClick={() => open({ kind: 'admin' })}><KeyRound size={16} />{ledger.editor ? 'Workspace' : 'Admin'}</button>
          <button className="icon-button settings-button" aria-label="Settings" onClick={() => open({ kind: 'settings' })}><Settings2 size={21} strokeWidth={1.8} /></button>
        </div>
      </div>
    </header>
    <main className={`layout${group ? ' ledger-layout' : ''}`} id="page-content" tabIndex={-1}>
      {showStatus && ledger.loading && <div className="loading" role="status">Loading groups…</div>}
      {showStatus && ledger.loadError && <div className="notice danger banner" role="alert"><CircleAlert size={18} /><span>{ledger.loadError}</span><button className="text-button" onClick={() => void ledger.refresh()}>Retry</button></div>}
      {showStatus && ledger.offline && <div className="notice banner" role="status"><CircleAlert size={18} /><span>Offline. Showing the last saved group directory.</span><button className="text-button" onClick={() => void ledger.refresh()}>Retry</button></div>}
      {showStatus && ledger.publication && <div className="notice banner" role="status"><CircleCheck size={18} /><span>Committed to GitHub. Waiting for GitHub Pages to publish.</span><button className="text-button" onClick={() => void ledger.refresh(ledger.publication ?? undefined)}>Check now</button></div>}
      {ledger.dirty && <div className="notice banner editor-banner">
        <span>{ledger.conflict ? 'Repository changed. Review your draft.' : 'Unpublished draft changes'}</span>
        <button className="text-button" onClick={() => open({ kind: 'admin' })}>Review draft <ChevronRight size={16} /></button>
      </div>}
      {!group && !showDirectory && <section className="landing" aria-labelledby="welcome-title">
        <span className="landing-icon"><LockKeyhole size={30} strokeWidth={1.65} aria-hidden="true" /></span>
        <h1 id="welcome-title">Shared expenses,<br />clear balances.</h1>
        <p>Choose your group and enter its password to see expenses, payments and who owes what.</p>
        <button className="button primary" onClick={() => {
          setShowDirectory(true)
          window.requestAnimationFrame(() => document.getElementById('directory-title')?.focus())
        }}>View groups <ArrowRight size={17} /></button>
      </section>}
      {!group && showDirectory && <section className="directory" aria-labelledby="directory-title">
        <button className="text-button" onClick={() => exitGroup(false)}><ArrowLeft size={16} />Home</button>
        <header className="section-heading"><h1 id="directory-title" tabIndex={-1}>Groups</h1>
          {ledger.editor && <button className="button primary" onClick={() => open({ kind: 'group' })}><Plus size={17} />New group</button>}
        </header>
        {visibleGroups.length > 0 ? <ul className="list-surface group-list">{visibleGroups.map(entry => <li key={entry.id}>
          <button onClick={() => open({ kind: 'unlock', entry })}>
            <span className="tile tone-lavender" aria-hidden="true"><UsersRound size={20} /></span>
            <span><strong>{entry.name}</strong>{entry.archived && <small>Archived</small>}</span>
            <LockKeyhole className="muted" size={18} aria-hidden="true" />
          </button>
        </li>)}</ul> : ledger.directory && <Empty title="No groups yet">Groups appear here after an organiser publishes them.</Empty>}
      </section>}
      {group && screenProps && <>
        <div className="group-return">
          <button className="text-button" onClick={() => exitGroup(true)}><ArrowLeft size={16} />All groups</button>
          <button className="text-button" onClick={() => exitGroup(false)}><LockKeyhole size={15} />Lock group</button>
        </div>
        <section className="group-heading" aria-label="Current group">
          <div className="group-emblem"><UsersRound size={26} strokeWidth={1.65} aria-hidden="true" /></div>
          <div className="group-text">
            <h1 id="group-title" tabIndex={-1}>{group.name}</h1>
            {group.description && <p>{group.description}</p>}
            <button className="people-button" aria-label="View group members" onClick={() => open({ kind: 'members' })}>
              {!!activeMembers.length && <span className="avatar-stack" aria-hidden="true">{activeMembers.slice(0, 4).map((member, index) => <Avatar member={member} index={index} key={member.id} />)}</span>}
              <span>{activeMembers.length} {activeMembers.length === 1 ? 'member' : 'members'} · {group.currency}{group.archived && ' · Archived'}</span>
            </button>
          </div>
          {canEdit && <button className="button primary add-expense" onClick={() => startExpense()}><Plus size={20} />Add expense</button>}
        </section>
        <div key={group.id} className="view">
          {view === 'overview' && <Overview {...screenProps} pairs={pairs} members={members} memberId={memberId} selectMember={setIdentity}
            openExpenses={() => go('expenses')} openSessions={() => open({ kind: 'sessions' })} />}
          {view === 'expenses' && <Expenses {...screenProps} memberId={memberId} />}
          {view === 'calendar' && <ExpenseCalendar {...screenProps} add={canEdit ? startExpense : undefined} />}
          {view === 'balances' && <Balances {...screenProps} pairs={pairs} settle={pair => open({ kind: 'payment', pair })} />}
          {view === 'activity' && <ActivityFeed events={data?.activity ?? []} />}
        </div>
        <footer className="page-footer"><span className="status-dot" />{ledger.editor ? 'Admin workspace' : 'Viewer access'}</footer>
      </>}
    </main>
    <p role="status" className="sr-only">{message}</p>
    {renderPanel()}
  </>
}
