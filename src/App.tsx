import { useEffect, useRef, useState } from 'react'
import { Archive, ArrowLeftRight, ArrowRight, CalendarDays, History, LayoutGrid, Link2, LockKeyhole, LogOut, Pencil, Plus, ReceiptText, Settings2 } from 'lucide-react'
import { AccountPanel, AuthCard, useAccount } from './Accounts'
import { ExpenseCalendar } from './ExpenseCalendar'
import { accountError, changeGroupArchive, cloudGroupId, firebaseConfigured, isPlatformAdmin, joinCloudGroup, readGroupHead, signOutAccount, summariseGroup, type Account } from './firebase'
import { ExpenseForm, groupCurrencyLocked, GroupForm, MemberForm, PaymentForm } from './forms'
import { ImportGroup, ShareGroup } from './GroupActions'
import { MyGroups, PlatformGroups } from './GroupDirectory'
import { registerPaymentMethod, type Expense, type Group, type Member, type Payment } from './model'
import { assertSettlement, calculateBalances, money, settlementPairs, type PairBalance } from './money'
import { firstName, memberLabels } from './people'
import { launchScreen, routeFrom, urlFor, type GroupView, type Route } from './routing'
import { ActivityFeed, Balances, Expenses, Overview } from './screens'
import { Settings, useSettingsRequest, type Theme } from './Settings'
import { Avatar, MemberRoster, Sheet } from './ui'
import { useLedger } from './useLedger'
import { maxPasswordLength } from './vault'

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'expenses', label: 'Expenses', icon: ReceiptText },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'balances', label: 'Balances', icon: ArrowLeftRight },
  { id: 'activity', label: 'Activity', icon: History },
] as const

type MemberPage = { kind: 'members' } | { kind: 'member'; member?: Member; self?: boolean }
type Panel =
  | { kind: 'settings' | 'account' | 'invite' | 'share' | 'import' }
  | { kind: 'group'; group?: Group; newId?: string }
  | { kind: 'archive'; id: string; name: string; restore?: boolean }
  | MemberPage
  | { kind: 'expense'; expense?: Expense; date?: string; roster?: MemberPage }
  | { kind: 'payment'; payment?: Payment; pair?: PairBalance }
  | { kind: 'settlement'; memberId: string }

function readTheme(): Theme {
  try {
    const value = localStorage.getItem('tally:theme')
    return value === 'dark' || value === 'light' ? value : 'system'
  } catch { return 'system' }
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
      <input ref={password} type="password" autoComplete="off" required maxLength={maxPasswordLength} disabled={busy} />
    </label>
    <button className="button primary" disabled={busy}><LockKeyhole size={17} />{busy ? 'Unlocking…' : 'Unlock group'}</button>
  </form>
}

function InviteForm({ openInvite }: { openInvite: (code: string) => void }) {
  const [invite, setInvite] = useState('')
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); openInvite(invite) }}>
    <label className="field"><span>Invitation link or group code</span>
      <input value={invite} onChange={event => setInvite(event.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
    </label>
    <button className="button primary">Continue <ArrowRight size={16} /></button>
  </form>
}

function LockedGroup({ route, admin, adminReady, busy, unlock, join }: {
  route: Extract<Route, { page: 'group' }>; admin: boolean; adminReady: boolean; busy: boolean;
  unlock: (password: string) => void; join: () => void;
}) {
  const [head, setHead] = useState<{ name: string; archived: boolean }>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const { id, archived, token } = route
  useEffect(() => {
    if (token || (archived && !admin)) return
    let mounted = true
    setHead(undefined)
    setError('')
    void readGroupHead(id).then(value => {
      if (mounted) setHead({ name: value.summary?.name ?? value.legacyName ?? 'Unlock group', archived: Boolean(value.archivedAt) })
    }).catch(issue => { if (mounted) setError(accountError(issue)) })
    return () => { mounted = false }
  }, [id, archived, token, admin, attempt])

  if (archived && !admin) return adminReady ? <p className="notice danger" role="alert">This group is unavailable to your account.</p>
    : <p className="loading" role="status">Checking access…</p>
  if (token) return <section className="auth-card">
    <h1>Join group</h1>
    <p>Accept this invitation with your account. Then enter the group password from the organiser.</p>
    <button className="button primary" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Accept invitation'}</button>
  </section>
  if (error) return <div className="form-stack">
    <p className="notice danger" role="alert">{error}</p>
    <button className="text-button" onClick={() => setAttempt(current => current + 1)}>Try again</button>
  </div>
  if (!head) return <p className="loading" role="status">Checking group access…</p>
  if (head.archived !== archived) return <p className="notice" role="status">
    {head.archived ? 'Open this archived group from Platform Admin.' : 'This group has been restored. Open it from My Groups if you’re a member.'}
  </p>
  return <section className="auth-card">
    <h1>{head.name}</h1>
    <p>Use the password shared by the group organiser.</p>
    <UnlockForm busy={busy} unlock={unlock} />
  </section>
}

export default function App() {
  const auth = useAccount()
  const request = useSettingsRequest()
  const [theme, setTheme] = useState(readTheme)
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

  function changeTheme(value: Theme) {
    setTheme(value)
    try { localStorage.setItem('tally:theme', value) } catch { /* Preferences are optional. */ }
  }

  const screen = launchScreen(firebaseConfigured, auth.loading, Boolean(auth.account))
  if (screen === 'dashboard' && auth.account) {
    return <SignedInApp key={auth.account.id} account={auth.account} theme={theme} changeTheme={changeTheme} />
  }
  return <main className="layout auth-layout" id="page-content">
    <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally</div>
    {screen === 'loading' ? <p className="loading" role="status">Checking your session…</p> :
      screen === 'setup' ? <p className="notice" role="status">Set up Firebase Authentication to use this deployment of Tally.</p> :
      auth.error ? <div className="form-stack"><p className="notice danger" role="alert">{auth.error}</p>
        <button className="text-button" onClick={auth.retry}>Try again</button></div> :
      <AuthCard busy={request.busy} error={request.error} run={request.run} clearError={request.clearError} />}
  </main>
}

function SignedInApp({ account, theme, changeTheme }: {
  account: Account; theme: Theme; changeTheme: (theme: Theme) => void;
}) {
  const ledger = useLedger(account)
  const { data } = ledger
  const request = useSettingsRequest()
  const [route, setRoute] = useState(() => routeFrom(new URL(location.href)))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [focusTransaction, setFocusTransaction] = useState<string>()
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState(0)
  const [admin, setAdmin] = useState(false)
  const [adminReady, setAdminReady] = useState(false)
  const expenseMembersButton = useRef<HTMLButtonElement>(null)
  const routeId = route.page === 'group' ? route.id : ''
  const archived = route.page === 'group' && route.archived
  const group = account.verified && routeId === ledger.cloud?.id &&
    Boolean(ledger.cloud?.archivedAt) === archived && (!archived || admin) ? data?.groups[0] : undefined
  const members = data?.members ?? []
  const activeMembers = members.filter(member => member.active)
  const memberId = ledger.cloudOwner ? group?.ownerMemberId ?? '' : ledger.cloud?.memberId ?? ''
  const expenses = data?.expenses ?? []
  const payments = data?.payments ?? []
  const pairs = calculateBalances(expenses, payments)
  const labels = memberLabels(members)
  const nameOf = (id: string) => labels.get(id) ?? 'Unknown member'
  const fullNameOf = (id: string) => members.find(member => member.id === id)?.name ?? nameOf(id)
  const canEdit = Boolean(group && ledger.cloudOwner)
  const busy = request.busy || ledger.working

  useEffect(() => {
    if (!account.verified) return
    let mounted = true
    function checkAdmin() {
      void isPlatformAdmin().then(value => { if (mounted) setAdmin(value) })
        .catch(() => { if (mounted) setAdmin(false) }).finally(() => { if (mounted) setAdminReady(true) })
    }
    checkAdmin()
    window.addEventListener('focus', checkAdmin)
    return () => { mounted = false; window.removeEventListener('focus', checkAdmin) }
  }, [account.verified])

  useEffect(() => {
    function sync() {
      setRoute(routeFrom(new URL(location.href)))
      setPanel(null)
      setFocusTransaction(undefined)
    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync) }
  }, [])

  useEffect(() => {
    if (ledger.cloud && (routeId !== ledger.cloud.id || Boolean(ledger.cloud.archivedAt) !== archived ||
      (archived && !admin) || !account.verified)) ledger.lock()
  }, [routeId, archived, admin, account.verified, ledger.cloud])

  function open(next: Panel | null) {
    request.clearError()
    setPanel(next)
  }

  function navigate(next: Route, replace = false) {
    const url = urlFor(next, new URL(location.href))
    if (url.href !== location.href) window.history[replace ? 'replaceState' : 'pushState'](null, '', url)
    setRoute(next)
    open(null)
    window.scrollTo({ top: 0 })
  }

  function go(view: GroupView, focus?: string) {
    if (route.page !== 'group') return
    setFocusTransaction(focus)
    navigate({ ...route, token: '', view })
  }

  function openGroup(id: string, archivedGroup = false, token = '') {
    setFocusTransaction(undefined)
    navigate({ page: 'group', id, archived: archivedGroup, token, view: 'overview' })
  }

  function openInvite(input: string) {
    try {
      const value = input.trim()
      const link = /^[A-Za-z0-9_-]+$/.test(value)
        ? new URL(`?group=${encodeURIComponent(value)}`, location.href) : new URL(value, location.href)
      const target = routeFrom(link)
      if (target.page !== 'group') throw new Error('Enter a valid group invitation link or code.')
      openGroup(target.id, false, target.token)
    } catch {
      void request.run(() => { throw new Error('Enter a valid group invitation link or code.') })
    }
  }

  function perform(work: () => Promise<void>) {
    void request.run(async () => {
      try { await work() } catch (issue) { throw new Error(accountError(issue)) }
    })
  }

  function logOut() {
    perform(async () => {
      await signOutAccount()
      window.history.replaceState(null, '', urlFor({ page: 'groups' }, new URL(location.href)))
    })
  }

  function startExpense(date?: string) {
    if (canEdit) open(activeMembers.length ? { kind: 'expense', date } : { kind: 'members' })
  }

  function changed(next: Panel | null = null) {
    open(next)
    setMessage('Changes saved.')
    setVersion(current => current + 1)
  }

  async function saveGroup(record: Group, password: string, original?: Group, newId?: string, ownerName?: string) {
    if (original) {
      await ledger.change(draft => upsert(draft.groups, record), {
        groupId: record.id, entityId: record.id, entity: 'group', title: record.name, action: 'updated',
      }, password)
      changed()
    } else if (newId) {
      await ledger.createGroup({ ...record, id: newId }, password, ownerName)
      openGroup(newId)
      changed({ kind: 'members' })
    }
  }

  async function saveMember(record: Member, original?: Member, self?: boolean) {
    await ledger.change(draft => {
      upsert(draft.members, record)
      if (self) draft.groups[0].ownerMemberId = record.id
    }, {
      groupId: record.groupId, entityId: record.id, entity: 'member', title: record.name,
      action: !original ? 'created' : record.active === original.active ? 'updated' : record.active ? 'restored' : 'archived',
    })
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
    await ledger.change(draft => {
      if (!original) {
        if (draft.payments.some(payment => payment.id === record.id)) throw new Error('This payment was already recorded.')
        assertSettlement(record, draft.expenses, draft.payments, draft.groups[0].currency)
      }
      upsert(draft.payments, { ...record, paymentMethod: registerPaymentMethod(draft, record.groupId, record.paymentMethod) })
    }, {
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

  const editExpense = (expense: Expense) => open({ kind: 'expense', expense })
  const editPayment = (payment: Payment) => open({ kind: 'payment', payment })
  const close = () => open(null)
  const requestError = request.error && <p className="notice danger settings-error" role="alert">{request.error}</p>
  function renderMemberPage(page: MemberPage, navigateMember: (next: MemberPage) => void) {
    if (page.kind === 'member' && group && canEdit) {
      return <MemberForm member={page.member} group={group} defaultName={page.self ? firstName(account.name).slice(0, 100) : undefined}
        canLink={Boolean(page.member && page.member.id !== group.ownerMemberId)}
        save={async (record, link) => {
          await saveMember(record, page.member, page.self || link)
          navigateMember({ kind: 'members' })
          setMessage('Member saved.')
        }} />
    }
    return <MemberRoster members={members} nameOf={nameOf}
      addSelf={canEdit && !memberId ? () => navigateMember({ kind: 'member', self: true }) : undefined}
      edit={canEdit ? member => navigateMember({ kind: 'member', member }) : undefined} />
  }

  function renderPanel() {
    if (!panel) return null
    if (panel.kind === 'settings') return <Sheet key="settings" title="Settings" close={close} busy={busy}>
      {requestError}
      <Settings theme={theme} changeTheme={changeTheme} />
      {!group && <button className="text-button" onClick={() => open({ kind: 'import' })}>Import a legacy group</button>}
    </Sheet>
    if (panel.kind === 'account') return <Sheet key="account" title="Account" close={close} busy={busy}>
      {requestError}<AccountPanel account={account} busy={busy} run={request.run} signOut={logOut} />
    </Sheet>
    if (panel.kind === 'invite') return <Sheet key="invite" title="Join group" close={close} busy={busy}>
      {requestError}<InviteForm openInvite={openInvite} />
    </Sheet>
    if (panel.kind === 'import') return <Sheet key="import" title="Import a legacy group" close={close} busy={busy}>
      {requestError}
      <ImportGroup busy={busy} run={request.run} save={async (file, id, password) => {
        await ledger.importGroup(file, id, password)
        ledger.lock()
        changed()
      }} />
    </Sheet>
    if (panel.kind === 'share' && group && canEdit) return <Sheet key="share" title="Share invite" close={close}
      description="Create a one-time invitation for a member. Share the group password separately.">
      <ShareGroup id={group.id} members={members} ownerMemberId={group.ownerMemberId} nameOf={nameOf} />
    </Sheet>
    if (panel.kind === 'archive') {
      const { id, name, restore } = panel
      if (!(admin || (canEdit && group?.id === id && !restore))) return null
      return <Sheet key="archive" title={restore ? 'Restore group?' : 'Archive group?'} close={close} busy={busy}
        description={restore ? `Restore access to ${name} for its owner and members.`
          : `${name} will be hidden from its owner and members. All records will be kept, and only the platform admin can access or restore it.`}>
        {requestError}
        <div className="inline-actions">
          <button type="button" className="button" disabled={busy} onClick={close}>Cancel</button>
          <button type="button" className={restore ? 'button primary' : 'button danger-button'} disabled={busy}
            onClick={() => perform(async () => {
              await changeGroupArchive(id, !restore, group?.id === id && data ? summariseGroup(data) : undefined)
              if (group?.id === id) {
                ledger.lock()
                navigate({ page: archived ? 'admin' : 'groups' }, true)
              }
              changed()
            })}>{busy ? 'Saving…' : restore ? 'Restore group' : 'Archive group'}</button>
        </div>
      </Sheet>
    }
    if (panel.kind === 'group' && (panel.group ? group && data && canEdit : panel.newId)) {
      return <Sheet key="group" title={panel.group ? 'Edit group' : 'Create group'} close={close} busy={busy}>
        <GroupForm group={panel.group} currencyLocked={Boolean(panel.group && data && groupCurrencyLocked(data, panel.group.id))}
          defaultOwnerName={panel.newId ? firstName(account.name) : undefined}
          save={(record, password, ownerName) => saveGroup(record, password, panel.group, panel.newId, ownerName)} />
      </Sheet>
    }
    if (!group) return null
    if (panel.kind === 'members') return <Sheet key="members" title="Group members" close={close}>
      {renderMemberPage(panel, open)}
    </Sheet>
    if (!canEdit) return null
    if (panel.kind === 'member') return <Sheet key="member" title={panel.member ? 'Edit member' : panel.self ? 'Add myself' : 'Add member'}
      backLabel="Group members" close={() => open({ kind: 'members' })} busy={busy}>
      {renderMemberPage(panel, open)}
    </Sheet>
    if (panel.kind === 'expense') {
      const { expense, date, roster } = panel
      const title = roster?.kind === 'member' ? roster.member ? 'Edit member' : roster.self ? 'Add myself' : 'Add member'
        : roster ? 'Group members' : expense ? 'Edit expense' : 'Add expense'
      const backLabel = roster?.kind === 'member' ? 'Group members' : roster ? 'Back to expense' : undefined
      function navigateRoster(next?: MemberPage) {
        open({ kind: 'expense', expense, date, roster: next })
        if (!next) window.requestAnimationFrame(() => expenseMembersButton.current?.focus())
      }
      return <Sheet key="expense" title={title} backLabel={backLabel} busy={busy}
        close={roster ? () => navigateRoster(roster.kind === 'member' ? { kind: 'members' } : undefined) : close}>
        <div hidden={Boolean(roster)}>
          <ExpenseForm group={group} members={members} nameOf={nameOf} memberId={memberId} expense={expense} occurrenceDate={date}
            save={record => saveExpense(record, expense)} remove={expense ? () => removeExpense(expense) : undefined}
            manageMembers={() => navigateRoster({ kind: 'members' })} manageButton={expenseMembersButton} />
        </div>
        {roster && renderMemberPage(roster, navigateRoster)}
      </Sheet>
    }
    if (panel.kind === 'settlement') {
      const options = settlementPairs(pairs, panel.memberId)
      return <Sheet key="settlement" title={`Settle up with ${nameOf(panel.memberId)}`} close={close} busy={busy}>
        {options.length ? <div className="form-stack">
          {options.map(pair => <button className="button" key={`${pair.from}:${pair.to}`} onClick={() => open({ kind: 'payment', pair })}>
            <span>{nameOf(pair.from)} → {nameOf(pair.to)}</span><ArrowRight size={16} aria-hidden="true" />
          </button>)}
        </div> : <p className="muted">No outstanding payments for this member.</p>}
      </Sheet>
    }
    if (panel.kind === 'payment') {
      const { payment, pair } = panel
      return <Sheet key="payment" title={payment ? 'Edit payment' : 'Settle up'} close={close} busy={busy}>
        <PaymentForm group={group} members={members} nameOf={nameOf} expenses={expenses} payments={payments} pair={pair} payment={payment}
          save={record => savePayment(record, payment)} remove={payment ? () => removePayment(payment) : undefined} />
      </Sheet>
    }
    return null
  }

  const screenProps = group && { currency: group.currency, nameOf, expenses, payments, canEdit, editExpense, editPayment }
  const activeView = route.page === 'group' ? route.view : 'overview'
  const home = urlFor({ page: 'groups' }, new URL(location.href))
  const adminUrl = urlFor({ page: 'admin' }, new URL(location.href))
  function settleMember(id: string) {
    const options = settlementPairs(pairs, id)
    if (options.length === 1) open({ kind: 'payment', pair: options[0] })
    else if (options.length) open({ kind: 'settlement', memberId: id })
  }

  return <>
    <a className="skip-link" href="#page-content" onClick={event => { event.preventDefault(); document.getElementById('page-content')?.focus() }}>Skip to content</a>
    <header className="site-header">
      <div className={`header-inner${group ? '' : ' without-group'}`}>
        <a className="brand" href={home.href} onClick={event => { event.preventDefault(); navigate({ page: 'groups' }) }} aria-label="Tally, My Groups">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally
        </a>
        {group && route.page === 'group' && <nav className="primary-nav admin-nav" aria-label="Group navigation">
          {views.map(({ id, label, icon: Icon }) => <a href={urlFor({ ...route, token: '', view: id }, new URL(location.href)).href}
            key={id} aria-current={activeView === id ? 'page' : undefined} onClick={event => { event.preventDefault(); go(id) }}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span>
          </a>)}
        </nav>}
        <nav className="header-actions" aria-label="Main navigation">
          {account.verified && admin && <a className="text-button header-admin" href={adminUrl.href}
            aria-current={route.page === 'admin' ? 'page' : undefined}
            onClick={event => { event.preventDefault(); navigate({ page: 'admin' }) }}>Admin</a>}
          <button className="text-button header-admin" onClick={() => open({ kind: 'account' })}>Account</button>
          <button className="icon-button" aria-label="Log out" title="Log out" disabled={busy} onClick={logOut}><LogOut size={17} /></button>
          {account.verified && <button className="icon-button settings-button" aria-label="Settings"
            onClick={() => open({ kind: 'settings' })}><Settings2 size={20} /></button>}
        </nav>
      </div>
    </header>
    <main className={`layout${group ? ' ledger-layout' : ''}`} id="page-content" tabIndex={-1}>
      {!panel && requestError}
      {ledger.accessError && !group && <p className="notice danger" role="alert">{ledger.accessError}</p>}
      {!account.verified ? <section className="auth-card">
        <h1>Verify your email</h1><AccountPanel account={account} busy={busy} run={request.run} signOut={logOut} />
      </section> : route.page === 'admin' ? admin ? <PlatformGroups version={version} open={id => openGroup(id, true)}
        archive={record => open({ kind: 'archive', id: record.id, name: record.summary?.name ?? record.legacyName ?? 'This group', restore: Boolean(record.archivedAt) })} />
        : <p className={adminReady ? 'notice danger' : 'loading'} role={adminReady ? 'alert' : 'status'}>
          {adminReady ? 'Platform Admin is unavailable to your account.' : 'Checking access…'}</p>
        : route.page === 'groups' ? <MyGroups accountId={account.id} version={version}
          create={() => open({ kind: 'group', newId: cloudGroupId() })} join={() => open({ kind: 'invite' })} open={openGroup} />
        : !group && <LockedGroup key={`${route.id}:${route.archived}:${route.token}`} route={route} admin={admin} adminReady={adminReady} busy={busy}
          unlock={password => perform(async () => {
            await ledger.unlock(route.id, password, route.archived)
            window.requestAnimationFrame(() => document.getElementById('group-title')?.focus())
          })}
          join={() => perform(async () => {
            await joinCloudGroup(route.id, route.token)
            setVersion(current => current + 1)
            navigate({ ...route, token: '' }, true)
          })} />}
      {group && screenProps && <>
        <section className="group-heading" aria-label="Current group">
          <div className="group-text">
            <h1 id="group-title" tabIndex={-1}>{group.name}</h1>
            {group.description && <p>{group.description}</p>}
            <div className="group-actions">
              <button className="people-button" aria-label="Group members" onClick={() => open({ kind: 'members' })}>
                {!!activeMembers.length && <span className="avatar-stack" aria-hidden="true">{activeMembers.slice(0, 4).map((member, index) =>
                  <Avatar member={member} index={index} key={member.id} />)}</span>}
                {activeMembers.length} {activeMembers.length === 1 ? 'member' : 'members'}
              </button>
              {canEdit && <details className="group-menu">
                <summary className="text-button">Manage group</summary>
                <div className="group-menu-actions">
                  <button className="text-button" onClick={event => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    open({ kind: 'group', group })
                  }}><Pencil size={15} />Edit group</button>
                  <button className="text-button" onClick={event => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    open({ kind: 'share' })
                  }}><Link2 size={15} />Share invite</button>
                  <button className="text-button negative" onClick={event => {
                    event.currentTarget.closest('details')?.removeAttribute('open')
                    open({ kind: 'archive', id: group.id, name: group.name })
                  }}><Archive size={15} />Archive group</button>
                </div>
              </details>}
              {archived && <button className="text-button" onClick={() => open({ kind: 'archive', id: group.id, name: group.name, restore: true })}>Restore group</button>}
            </div>
          </div>
          {canEdit && <button className="button primary add-expense" onClick={() => startExpense()}><Plus size={20} />Add expense</button>}
        </section>
        <div key={group.id} className="view">
          {activeView === 'overview' && <Overview {...screenProps} pairs={pairs} members={members} settle={settleMember}
            events={data?.activity ?? []} openExpenses={() => go('expenses')} openTransaction={id => go('expenses', id)} />}
          {activeView === 'expenses' && <Expenses key={focusTransaction} {...screenProps} memberId={memberId}
            fullNameOf={fullNameOf} canExport={canEdit} focusTransaction={focusTransaction} />}
          {activeView === 'calendar' && <ExpenseCalendar {...screenProps} memberId={memberId} add={canEdit ? startExpense : undefined} />}
          {activeView === 'balances' && <Balances {...screenProps} pairs={pairs} settle={pair => open({ kind: 'payment', pair })} />}
          {activeView === 'activity' && <ActivityFeed events={data?.activity ?? []} />}
        </div>
      </>}
    </main>
    <p role="status" className="sr-only">{message}</p>
    {account.verified ? renderPanel() : panel?.kind === 'account' && renderPanel()}
  </>
}
