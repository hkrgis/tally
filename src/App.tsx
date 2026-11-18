import { useEffect, useState } from 'react'
import { ArrowLeftRight, ChevronDown, ChevronRight, CircleAlert, CircleCheck, History, LayoutGrid, Plus, ReceiptText, Settings2, UsersRound } from 'lucide-react'
import { ExpenseForm, groupCurrencyLocked, GroupForm, MemberForm, PaymentForm, SessionForm, SessionsList } from './forms'
import { type Expense, type Group, type Member, type Payment, type SportsSession } from './model'
import { calculateBalances, type PairBalance } from './money'
import { ActivityFeed, Balances, Expenses, Overview } from './screens'
import { Settings, useSettingsRequest, type Theme } from './Settings'
import { Avatar, Empty, Sheet } from './ui'
import { useLedger } from './useLedger'

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'expenses', label: 'Expenses', icon: ReceiptText },
  { id: 'balances', label: 'Balances', icon: ArrowLeftRight },
  { id: 'activity', label: 'Activity', icon: History },
] as const

type View = typeof views[number]['id']
type Panel =
  | { kind: 'settings' | 'members' | 'sessions' }
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

export default function App() {
  const ledger = useLedger()
  const { data } = ledger
  const request = useSettingsRequest()
  const [view, setView] = useState(currentView)
  const [groupId, setGroupId] = useState(() => readPref('group'))
  const [identity, setIdentity] = useState(() => readPref('identity'))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [afterEditor, setAfterEditor] = useState<Panel | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const value = readPref('theme')
    return value === 'dark' || value === 'light' ? value : 'system'
  })
  const [message, setMessage] = useState('')
  const group = data?.groups.find(item => item.id === groupId) ?? data?.groups.find(item => !item.archived) ?? data?.groups[0]
  const members = data?.members.filter(member => member.groupId === group?.id) ?? []
  const activeMembers = members.filter(member => member.active)
  const memberId = members.find(member => member.id === identity)?.id ?? activeMembers[0]?.id ?? members[0]?.id ?? ''
  const expenses = data?.expenses.filter(expense => expense.groupId === group?.id) ?? []
  const payments = data?.payments.filter(payment => payment.groupId === group?.id) ?? []
  const sessions = data?.sessions.filter(session => session.groupId === group?.id) ?? []
  const pairs = calculateBalances(expenses, payments)
  const nameOf = (id: string) => members.find(member => member.id === id)?.name ?? 'Unknown member'
  const canEdit = Boolean(ledger.editor && group && !group.archived)

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
    if (view !== next) {
      window.location.hash = next
      setView(next)
      window.scrollTo({ top: 0 })
    }
  }
  function selectGroup(id: string) { setGroupId(id); writePref('group', id) }
  function selectMember(id: string) { setIdentity(id); writePref('identity', id) }
  function open(next: Panel | null) {
    request.clearError()
    setAfterEditor(null)
    setPanel(next)
  }
  function startExpense() {
    if (!group || group.archived) { open({ kind: 'settings' }); return }
    if (!ledger.editor) {
      open({ kind: 'settings' })
      setAfterEditor({ kind: activeMembers.length ? 'expense' : 'members' })
      return
    }
    open({ kind: activeMembers.length ? 'expense' : 'members' })
  }
  function editorReady() {
    if (afterEditor) open(afterEditor)
  }
  function changed(next: Panel | null = null) {
    open(next)
    setMessage('Saved to draft.')
  }
  function saveGroup(record: Group, original?: Group) {
    ledger.change(draft => upsert(draft.groups, record), {
      groupId: record.id, entityId: record.id, entity: 'group', title: record.name,
      action: !original ? 'created' : record.archived === original.archived ? 'updated' : record.archived ? 'archived' : 'restored',
    })
    selectGroup(record.id)
    changed({ kind: 'members' })
  }
  function saveMember(record: Member, original?: Member) {
    ledger.change(draft => upsert(draft.members, record), {
      groupId: record.groupId, entityId: record.id, entity: 'member', title: record.name,
      action: !original ? 'created' : record.active === original.active ? 'updated' : record.active ? 'restored' : 'archived',
    })
    changed({ kind: 'members' })
  }
  function saveExpense(record: Expense, original?: Expense) {
    ledger.change(draft => upsert(draft.expenses, record), {
      groupId: record.groupId, entityId: record.id, entity: 'expense', title: record.description, action: original ? 'updated' : 'created',
    })
    changed()
  }
  function removeExpense(record: Expense) {
    ledger.change(draft => { draft.expenses = draft.expenses.filter(expense => expense.id !== record.id) }, {
      groupId: record.groupId, entityId: record.id, entity: 'expense', title: record.description, action: 'removed',
    })
    changed()
  }
  const paymentTitle = (record: Payment) => `${nameOf(record.from)} → ${nameOf(record.to)}`.slice(0, 100)
  function savePayment(record: Payment, original?: Payment) {
    ledger.change(draft => upsert(draft.payments, record), {
      groupId: record.groupId, entityId: record.id, entity: 'payment', title: paymentTitle(record), action: original ? 'updated' : 'created',
    })
    changed()
  }
  function removePayment(record: Payment) {
    ledger.change(draft => { draft.payments = draft.payments.filter(payment => payment.id !== record.id) }, {
      groupId: record.groupId, entityId: record.id, entity: 'payment', title: paymentTitle(record), action: 'removed',
    })
    changed()
  }
  function saveSession(record: SportsSession, original?: SportsSession) {
    ledger.change(draft => upsert(draft.sessions, record), {
      groupId: record.groupId, entityId: record.id, entity: 'session', title: record.name,
      action: !original ? 'created' : record.active === original.active ? 'updated' : record.active ? 'restored' : 'archived',
    })
    changed({ kind: 'sessions' })
  }

  const editExpense = (expense: Expense) => open({ kind: 'expense', expense })
  const editPayment = (payment: Payment) => open({ kind: 'payment', payment })
  const close = () => open(null)
  function renderPanel() {
    if (!panel) return null
    if (panel.kind === 'settings') return <Sheet key="settings" title="Settings" close={close} busy={request.busy}>
      {request.error && <p className="notice danger settings-error" role="alert">{request.error}</p>}
      {ledger.publication && <p className="notice settings-error" role="status">Committed to GitHub. The public site will update when GitHub Pages finishes deploying.</p>}
      <Settings ledger={ledger} group={group} theme={theme} changeTheme={value => { setTheme(value); writePref('theme', value) }} busy={request.busy} run={request.run}
        onConnect={async token => { await ledger.connect(token); editorReady() }} onManual={actor => { ledger.beginManual(actor); editorReady() }}
        groupForm={value => open({ kind: 'group', group: value })} members={() => open({ kind: 'members' })} />
    </Sheet>
    if (panel.kind === 'group' && ledger.editor && data) return <Sheet key="group" title={panel.group ? 'Edit group' : 'New group'} close={close}>
      <GroupForm group={panel.group} currencyLocked={Boolean(panel.group && groupCurrencyLocked(data, panel.group.id))}
        save={record => saveGroup(record, panel.group)} />
    </Sheet>
    if (!group) return null
    if (panel.kind === 'sessions') return <Sheet key="sessions" title="Sports sessions" close={close} description="Confirm who attended before recording each court fee.">
      <SessionsList sessions={sessions} expenses={expenses} currency={group.currency}
        edit={canEdit ? session => open({ kind: 'session', session }) : undefined}
        record={canEdit ? (session, date) => open({ kind: 'expense', session, date }) : undefined}
        create={canEdit && activeMembers.length ? () => open({ kind: 'session' }) : undefined} />
      {!ledger.editor && !group.archived && <button className="button sheet-next" onClick={() => { open({ kind: 'settings' }); setAfterEditor({ kind: 'sessions' }) }}>Open editor</button>}
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
    if (panel.kind === 'member') return <Sheet key="member" title={panel.member ? 'Edit member' : 'Add member'} close={close}>
      <MemberForm group={group} member={panel.member} save={record => saveMember(record, panel.member)} />
    </Sheet>
    if (panel.kind === 'expense') {
      const { expense, session, date } = panel
      return <Sheet key="expense" title={expense ? 'Edit expense' : session ? 'Record sports session' : 'Add expense'} close={close}>
        <ExpenseForm group={group} members={members} memberId={memberId} expense={expense} session={session} occurrenceDate={date}
          save={record => saveExpense(record, expense)} remove={expense ? () => removeExpense(expense) : undefined} />
      </Sheet>
    }
    if (panel.kind === 'payment') {
      const { payment, pair } = panel
      return <Sheet key="payment" title={payment ? 'Edit payment' : 'Record payment'} close={close}>
        <PaymentForm group={group} members={members} expenses={expenses} payments={payments} pair={pair} payment={payment}
          save={record => savePayment(record, payment)} remove={payment ? () => removePayment(payment) : undefined} />
      </Sheet>
    }
    if (panel.kind === 'session') return <Sheet key="session" title={panel.session ? 'Edit sports schedule' : 'New sports schedule'} close={close}>
      <SessionForm group={group} members={members} session={panel.session} save={record => saveSession(record, panel.session)} />
    </Sheet>
    return null
  }

  const screenProps = group && { currency: group.currency, nameOf, expenses, payments, canEdit, editExpense, editPayment }
  return <>
    <a className="skip-link" href="#page-content" onClick={event => {
      event.preventDefault()
      document.getElementById('page-content')?.focus()
    }}>Skip to content</a>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="#overview" onClick={() => go('overview')} aria-label="Tally overview">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Tally<span className="brand-period">.</span></span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          {views.map(({ id, label, icon: Icon }) => <a href={`#${id}`} key={id} aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
          </a>)}
        </nav>
        <button className="icon-button settings-button" aria-label="Settings" onClick={() => open({ kind: 'settings' })}><Settings2 size={21} strokeWidth={1.8} /></button>
      </div>
    </header>
    <main className="layout" id="page-content" tabIndex={-1}>
      {ledger.loading && <div className="loading" role="status">Loading ledger…</div>}
      {ledger.loadError && <div className="notice danger banner" role="alert"><CircleAlert size={18} /><span>{ledger.loadError}</span><button className="text-button" onClick={() => void ledger.refresh()}>Retry</button></div>}
      {ledger.offline && <div className="notice banner" role="status"><CircleAlert size={18} /><span>Offline. Showing the last published ledger saved on this device.</span><button className="text-button" onClick={() => void ledger.refresh()}>Retry</button></div>}
      {ledger.publication && <div className="notice banner" role="status"><CircleCheck size={18} /><span>Committed to GitHub. Waiting for GitHub Pages to publish.</span><button className="text-button" onClick={() => void ledger.refresh(ledger.publication?.revision)}>Check now</button></div>}
      {ledger.editor && <div className="notice banner editor-banner">
        <span>{ledger.conflict ? 'Repository changed. Review your draft.' : ledger.dirty ? 'Unpublished draft changes' : ledger.editor.mode === 'github' ? `Editing as ${ledger.editor.actor}` : 'Export editor open'}</span>
        <button className="text-button" onClick={() => open({ kind: 'settings' })}>{ledger.dirty ? 'Review draft' : 'Editor settings'} <ChevronRight size={16} /></button>
      </div>}
      {data && !group && <Empty title="No groups yet"><button className="button primary" onClick={() => {
        if (ledger.editor) open({ kind: 'group' })
        else { open({ kind: 'settings' }); setAfterEditor({ kind: 'group' }) }
      }}><Plus size={17} />Create group</button></Empty>}
      {group && screenProps && <>
        <section className="group-heading" aria-label="Current group">
          <div className="group-emblem"><UsersRound size={26} strokeWidth={1.65} aria-hidden="true" /></div>
          <div className="group-text">
            <div className="group-picker">
              <h1>{group.name}</h1><ChevronDown size={19} aria-hidden="true" />
              <select aria-label="Select group" value={group.id} onChange={event => selectGroup(event.target.value)}>
                {data?.groups.filter(item => !item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                {data?.groups.some(item => item.archived) && <optgroup label="Archived">
                  {data.groups.filter(item => item.archived).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>}
              </select>
            </div>
            {group.description && <p>{group.description}</p>}
            <button className="people-button" aria-label="View group members" onClick={() => open({ kind: 'members' })}>
              {!!activeMembers.length && <span className="avatar-stack" aria-hidden="true">{activeMembers.slice(0, 4).map((member, index) => <Avatar member={member} index={index} key={member.id} />)}</span>}
              <span>{activeMembers.length} {activeMembers.length === 1 ? 'member' : 'members'} <span className="middot">·</span> {group.currency}{group.archived && ' · Archived'}</span>
            </button>
          </div>
          {!group.archived && <button className="button primary add-expense" onClick={startExpense}><Plus size={20} />Add expense</button>}
        </section>
        <div key={group.id} className="view">
          {view === 'overview' && <Overview {...screenProps} pairs={pairs} members={members} memberId={memberId} selectMember={selectMember}
            openExpenses={() => go('expenses')} openSessions={() => open({ kind: 'sessions' })} />}
          {view === 'expenses' && <Expenses {...screenProps} memberId={memberId} />}
          {view === 'balances' && <Balances {...screenProps} pairs={pairs} settle={pair => open({ kind: 'payment', pair })} />}
          {view === 'activity' && <ActivityFeed events={data?.activity.filter(event => event.groupId === group.id) ?? []} />}
        </div>
        <footer className="page-footer"><span className="status-dot" />{ledger.editor ? 'Editor view' : 'Published ledger'}<button className="text-button" onClick={() => open({ kind: 'settings' })}>About ledger access</button></footer>
      </>}
    </main>
    <p role="status" className="sr-only">{message}</p>
    {renderPanel()}
  </>
}
