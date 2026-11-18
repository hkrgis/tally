import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, ArrowRight, CalendarDays, CircleAlert, CircleCheck, History, LayoutGrid, Link2, LockKeyhole, LogOut, Pencil, Plus, ReceiptText, Save, Settings2, UsersRound } from 'lucide-react'
import { AccountPanel, useAccount } from './Accounts'
import { ExpenseCalendar } from './ExpenseCalendar'
import { accountError, cloudGroupId, firebaseConfigured, isCloudGroup, readCloudGroup, signOutAccount, type CloudGroup } from './firebase'
import { ExpenseForm, groupCurrencyLocked, GroupForm, MemberForm, PaymentForm, SessionForm, SessionsList } from './forms'
import { registerPaymentMethod, type Expense, type Group, type Member, type Payment, type SportsSession } from './model'
import { calculateBalances, type PairBalance } from './money'
import { ActivityFeed, Balances, Expenses, Overview } from './screens'
import { CopyField, SaveChanges, Settings, Workspace, useSettingsRequest, type Theme } from './Settings'
import { Avatar, Sheet } from './ui'
import { useLedger } from './useLedger'
import { inviteCode, maxPasswordLength, type GroupEntry } from './vault'

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'expenses', label: 'Expenses', icon: ReceiptText },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'balances', label: 'Balances', icon: ArrowLeftRight },
  { id: 'activity', label: 'Activity', icon: History },
] as const

type View = typeof views[number]['id']
type Panel =
  | { kind: 'settings' | 'admin' | 'account' | 'members' | 'sessions' | 'invite' | 'share' | 'save' | 'logout' }
  | { kind: 'unlock'; entry: GroupEntry; cloud?: CloudGroup }
  | { kind: 'group'; group?: Group; newAccountGroupId?: string }
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

function UnlockForm({ busy, unlock }: { busy: boolean; unlock: (password: string) => void }) {
  const password = useRef<HTMLInputElement>(null)
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault()
    const value = password.current?.value ?? ''
    if (password.current) password.current.value = ''
    unlock(value)
  }}>
    <label className="field"><span>Group password</span>
      <input ref={password} type="password" autoComplete="off" required
        maxLength={maxPasswordLength} disabled={busy} />
    </label>
    <button className="button primary" disabled={busy}><LockKeyhole size={17} />{busy ? 'Unlocking…' : 'Unlock group'}</button>
  </form>
}

function InviteForm({ busy, openInvite }: { busy: boolean; openInvite: (code: string) => void }) {
  const [invite, setInvite] = useState('')
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); openInvite(invite) }}>
    <label className="field"><span>Invite link or code</span>
      <input value={invite} onChange={event => setInvite(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} required disabled={busy} />
    </label>
    <button className="button primary" disabled={busy}>Continue <ArrowRight size={16} /></button>
  </form>
}

export default function App() {
  const accountState = useAccount()
  const { account } = accountState
  const ledger = useLedger(account)
  const { data } = ledger
  const request = useSettingsRequest()
  const [view, setView] = useState<View>('overview')
  const [linkedInvite, setLinkedInvite] = useState(() => inviteCode(new URLSearchParams(window.location.search).get('group') ?? ''))
  const [focusTransaction, setFocusTransaction] = useState<string>()
  const [saveContents, setSaveContents] = useState<string | null>(null)
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
  const localWorkspace = ledger.cloudOpen ? ledger.cloudOwner : Boolean(ledger.editor)
  const canEdit = Boolean(localWorkspace && group && !group.archived)
  const hasSession = Boolean(ledger.editor || account)
  const busy = request.busy || ledger.working

  useEffect(() => {
    const onHash = () => setView(currentView())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!ledger.dirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [ledger.dirty])
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
  function exitGroup(clearInvite = false) {
    ledger.lock()
    setIdentity('')
    setFocusTransaction(undefined)
    if (clearInvite) setLinkedInvite('')
    window.history.replaceState(null, '', window.location.pathname + (clearInvite ? '' : window.location.search))
    setView('overview')
    open(null)
    window.scrollTo({ top: 0 })
  }
  function showSave() {
    setSaveContents(null)
    open({ kind: 'save' })
    void request.run(async () => { setSaveContents(await ledger.prepareSave()) })
  }
  function logOut() {
    function closeSession() {
      ledger.closeEditor()
      setSaveContents(null)
      exitGroup(true)
    }
    if (account) void request.run(async () => {
      try { await signOutAccount() } catch (issue) {
        open({ kind: 'account' })
        throw new Error(accountError(issue))
      }
      closeSession()
    })
    else closeSession()
  }
  function openInvite(input: string) {
    void request.run(async () => {
      const id = inviteCode(input)
      let cloud: CloudGroup | undefined
      if (isCloudGroup(id)) {
        try { cloud = await readCloudGroup(id) } catch (issue) { throw new Error(accountError(issue)) }
      }
      const entry = cloud?.entry ?? (id && ledger.directory?.groups.find(item => item.id === id))
      if (!entry) throw new Error(ledger.loadError || 'This invite could not be found. Check the link or ask the organiser.')
      setLinkedInvite(id)
      const link = new URL(window.location.href)
      link.searchParams.set('group', id)
      link.hash = ''
      window.history.replaceState(null, '', link)
      open({ kind: 'unlock', entry, cloud })
    })
  }
  function startExpense(date?: string) {
    if (!canEdit) return
    open(activeMembers.length ? { kind: 'expense', date } : { kind: 'members' })
  }
  function changed(next: Panel | null = null) {
    open(next)
    setMessage('Changes applied in this workspace.')
  }
  async function saveGroup(record: Group, password: string, original?: Group, newAccountGroupId?: string) {
    if (original) {
      await ledger.change(draft => upsert(draft.groups, record), {
        groupId: record.id, entityId: record.id, entity: 'group', title: record.name,
        action: record.archived === original.archived ? 'updated' : record.archived ? 'archived' : 'restored',
      }, password)
      changed({ kind: ledger.cloudOpen ? 'account' : 'admin' })
    } else {
      await ledger.createGroup(newAccountGroupId ? { ...record, id: newAccountGroupId } : record, password)
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
    await ledger.change(draft => upsert(draft.expenses, {
      ...record, paymentMethod: registerPaymentMethod(draft, record.groupId, record.paymentMethod),
    }), {
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
    await ledger.change(draft => upsert(draft.payments, {
      ...record, paymentMethod: registerPaymentMethod(draft, record.groupId, record.paymentMethod),
    }), {
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
    if (panel.kind === 'admin') return <Sheet key="admin" title="Admin workspace" close={close} busy={busy}>
      {requestError}
      <Workspace ledger={ledger} group={ledger.cloudOpen ? undefined : group} busy={busy} run={request.run}
        groupForm={value => open({ kind: 'group', group: value })} members={() => open({ kind: 'members' })}
        unlock={entry => open({ kind: 'unlock', entry })} share={() => open({ kind: 'share' })} save={showSave} />
    </Sheet>
    if (panel.kind === 'account') return <Sheet key="account" title={account ? 'Account' : 'Sign in or create an account'} close={close} busy={busy}>
      {requestError}
      {accountState.error && <p className="notice danger settings-error" role="alert">{accountState.error}</p>}
      <AccountPanel account={account} loading={accountState.loading} busy={busy} run={request.run}
        newGroup={() => open({ kind: 'group', newAccountGroupId: cloudGroupId() })} openGroup={openInvite}
        editGroup={group && ledger.cloudOwner ? () => open({ kind: 'group', group }) : undefined}
        repositoryWorkspace={() => open({ kind: 'admin' })} />
    </Sheet>
    if (panel.kind === 'invite') return <Sheet key="invite" title="Open an invite" close={close} busy={busy}>
      {requestError}
      <InviteForm busy={busy || ledger.loading} openInvite={openInvite} />
    </Sheet>
    if (panel.kind === 'share' && group && localWorkspace) {
      const link = new URL(window.location.pathname, window.location.origin)
      link.searchParams.set('group', group.id)
      return <Sheet key="share" title="Share invite" description="Send the link and share the group password separately." close={close}>
        <CopyField value={link.href} label="Invite link" button="Copy invite" />
      </Sheet>
    }
    if (panel.kind === 'save' && ledger.editor) return <Sheet key="save" title="Save changes" close={close} busy={busy}>
      {requestError}
      <SaveChanges contents={saveContents} busy={busy} dirty={ledger.dirty} check={async () => {
        let saved: boolean | undefined
        await request.run(async () => { saved = await ledger.confirmSaved() })
        return saved
      }} />
    </Sheet>
    if (panel.kind === 'logout') return <Sheet key="logout" title="Log out?" description="There are unsaved changes in this workspace." close={close} busy={busy}>
      <div className="inline-actions">
        <button className="button primary" disabled={busy} onClick={showSave}>Save changes</button>
        <button className="button danger-button" disabled={busy} onClick={logOut}>Discard and log out</button>
      </div>
    </Sheet>
    if (panel.kind === 'unlock') {
      const { entry } = panel
      return <Sheet key={entry.id} title="Unlock group" description="Enter the password shared by your group organiser." close={close} busy={busy}>
        {requestError}
        <UnlockForm busy={busy} unlock={password => request.run(async () => {
          await ledger.unlock(entry, password, panel.cloud)
          setIdentity('')
          setFocusTransaction(undefined)
          go('overview')
          close()
          window.requestAnimationFrame(() => document.getElementById('group-title')?.focus())
        })} />
      </Sheet>
    }
    if (panel.kind === 'group' && (panel.group ? data && localWorkspace : panel.newAccountGroupId ? account?.verified : ledger.editor)) {
      return <Sheet key="group" title={panel.group ? 'Edit group' : 'New group'} close={close} busy={busy}>
      <GroupForm group={panel.group} currencyLocked={Boolean(panel.group && data && groupCurrencyLocked(data, panel.group.id))}
        save={(record, password) => saveGroup(record, password, panel.group, panel.newAccountGroupId)} />
      </Sheet>
    }
    if (!group) return null
    if (panel.kind === 'sessions' && localWorkspace) return <Sheet key="sessions" title="Sports sessions" close={close} description="Confirm who attended before recording each court fee.">
      <SessionsList sessions={sessions} expenses={expenses} currency={group.currency}
        edit={canEdit ? session => open({ kind: 'session', session }) : undefined}
        record={canEdit ? (session, date) => open({ kind: 'expense', session, date }) : undefined}
        create={canEdit && activeMembers.length ? () => open({ kind: 'session' }) : undefined} />
      {canEdit && activeMembers.length === 0 && <button className="button sheet-next" onClick={() => open({ kind: 'members' })}>Add group members</button>}
    </Sheet>
    if (panel.kind === 'members' && localWorkspace) return <Sheet key="members" title="Group members" close={close}>
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
  const allowedViews = localWorkspace ? views : views.filter(item => item.id !== 'activity')
  const activeView = !localWorkspace && view === 'activity' ? 'overview' : view
  const showStatus = group || ledger.editor || linkedInvite
  return <>
    <a className="skip-link" href="#page-content" onClick={event => {
      event.preventDefault()
      document.getElementById('page-content')?.focus()
    }}>Skip to content</a>
    <header className="site-header">
      <div className={`header-inner${group ? '' : ' without-group'}`}>
        <a className="brand" href="#" onClick={event => { event.preventDefault(); exitGroup(true) }} aria-label="Tally home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span><span>Tally<span className="brand-period">.</span></span>
        </a>
        {group && <nav className={`primary-nav${localWorkspace ? ' admin-nav' : ''}`} aria-label="Main navigation">
          {allowedViews.map(({ id, label, icon: Icon }) => <a href={`#${id}`} key={id} aria-current={activeView === id ? 'page' : undefined}
            onClick={event => { event.preventDefault(); setFocusTransaction(undefined); go(id) }}>
            <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
          </a>)}
        </nav>}
        <div className="header-actions">
          {(ledger.editor || !firebaseConfigured && !group && !linkedInvite) &&
            <button className="text-button header-admin" onClick={() => open({ kind: 'admin' })}><Pencil size={16} />Workspace</button>}
          {firebaseConfigured && !ledger.editor &&
            <button className="text-button header-admin" onClick={() => open({ kind: 'account' })}>{account ? 'Account' : 'Sign in'}</button>}
          {hasSession && <button className="icon-button" aria-label="Log out" title="Log out"
            onClick={() => ledger.dirty ? open({ kind: 'logout' }) : logOut()}><LogOut size={18} /></button>}
          {!hasSession && group && <button className="text-button header-admin" onClick={() => exitGroup()}><LockKeyhole size={15} />Lock</button>}
          <button className="icon-button settings-button" aria-label="Settings" onClick={() => open({ kind: 'settings' })}><Settings2 size={21} strokeWidth={1.8} /></button>
        </div>
      </div>
    </header>
    <main className={`layout${group ? ' ledger-layout' : ''}`} id="page-content" tabIndex={-1}>
      {showStatus && ledger.loading && <div className="loading" role="status">Loading shared data…</div>}
      {showStatus && ledger.loadError && <div className="notice danger banner" role="alert"><CircleAlert size={18} /><span>{ledger.loadError}</span><button className="text-button" onClick={() => void ledger.refresh()}>Retry</button></div>}
      {showStatus && ledger.offline && <div className="notice banner" role="status"><CircleAlert size={18} /><span>Offline. Using the last saved copy.</span><button className="text-button" onClick={() => void ledger.refresh()}>Retry</button></div>}
      {ledger.editor && ledger.publication && <div className="notice banner" role="status"><CircleCheck size={18} /><span>Saved on GitHub. Waiting for the live site to update.</span><button className="text-button" onClick={() => void ledger.refresh(ledger.publication ?? undefined)}>Check now</button></div>}
      {ledger.dirty && <div className="notice banner editor-banner">
        <span>Unsaved changes</span>
        <button className="button primary button-small" onClick={showSave}><Save size={16} />Save changes</button>
      </div>}
      {!group && <section className="landing" aria-labelledby="welcome-title">
        <span className="landing-icon"><LockKeyhole size={30} strokeWidth={1.65} aria-hidden="true" /></span>
        <h1 id="welcome-title">Shared expenses,<br />clear balances.</h1>
        <p>Open an invite to see shared expenses, payments and balances.</p>
        <button className="button primary" onClick={() => {
          open({ kind: 'invite' })
          if (linkedInvite) openInvite(linkedInvite)
        }} disabled={ledger.loading && !!linkedInvite}>Open an invite <ArrowRight size={17} /></button>
      </section>}
      {group && screenProps && <>
        {localWorkspace ? <section className="group-heading" aria-label="Current group">
          <div className="group-emblem"><UsersRound size={26} strokeWidth={1.65} aria-hidden="true" /></div>
          <div className="group-text">
            <h1 id="group-title" tabIndex={-1}>{group.name}</h1>
            {group.description && <p>{group.description}</p>}
            <button className="people-button" aria-label="View group members" onClick={() => open({ kind: 'members' })}>
              {!!activeMembers.length && <span className="avatar-stack" aria-hidden="true">{activeMembers.slice(0, 4).map((member, index) => <Avatar member={member} index={index} key={member.id} />)}</span>}
              <span>{activeMembers.length} {activeMembers.length === 1 ? 'member' : 'members'} · {group.currency}{group.archived && ' · Archived'}</span>
            </button>
            <button className="text-button share-shortcut" onClick={() => open({ kind: 'share' })}><Link2 size={15} />Share invite</button>
          </div>
          {canEdit && <button className="button primary add-expense" onClick={() => startExpense()}><Plus size={20} />Add expense</button>}
        </section> : <header className="viewer-heading"><h1 id="group-title" tabIndex={-1}>Shared expenses</h1></header>}
        <div key={group.id} className="view">
          {activeView === 'overview' && <Overview {...screenProps} pairs={pairs} members={members} memberId={memberId} selectMember={setIdentity} events={data?.activity ?? []}
            openExpenses={() => { setFocusTransaction(undefined); go('expenses') }} openTransaction={id => { setFocusTransaction(id); go('expenses') }}
            openSessions={localWorkspace ? () => open({ kind: 'sessions' }) : undefined} />}
          {activeView === 'expenses' && <Expenses key={focusTransaction} {...screenProps} memberId={memberId} canExport={localWorkspace} focusTransaction={focusTransaction} />}
          {activeView === 'calendar' && <ExpenseCalendar {...screenProps} memberId={memberId} add={canEdit ? startExpense : undefined} />}
          {activeView === 'balances' && <Balances {...screenProps} pairs={pairs} settle={pair => open({ kind: 'payment', pair })} />}
          {activeView === 'activity' && localWorkspace && <ActivityFeed events={data?.activity ?? []} />}
        </div>
      </>}
    </main>
    <p role="status" className="sr-only">{message}</p>
    {renderPanel()}
  </>
}
