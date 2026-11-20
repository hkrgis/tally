import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Bell, Eye, SunMoon, ArrowRight, ChevronDown, Ellipsis, House, Link2, LogOut, Pencil, Plus, RotateCcw, UsersRound } from 'lucide-react'
import { AccountPanel, AuthCard, useAccount } from './Accounts'
import { GroupNavigation } from './GroupNavigation'
import { GroupHome, People } from './GroupViews'
import { ExpenseCalendar } from './ExpenseCalendar'
import { accountError, changeGroupArchive, cloudGroupId, firebaseConfigured, isPlatformAdmin, joinCloudGroup, readCloudGroup, readGroupHead, signOutAccount, summariseGroup, type Account, type AccountLedger, type GroupHead } from './firebase'
import { ExpenseForm, groupCurrencyLocked, GroupForm, MemberForm, PaymentForm } from './forms'
import { ImportGroup, ShareGroup } from './GroupActions'
import { GuestEntry, GuestSharePanel, GuestView, guestToken } from './Guests'
import { AddMembers, DiscoverySettings, MemberInvitationList } from './MemberInvitations'
import { issueMemberInvite, inviteStatus, readIssuedInvite, receivedInvites, watchInbox, type InviteDraft, type MemberInvite } from './memberInvites'
import { MyGroups, PlatformGroups } from './GroupDirectory'
import { registerPaymentMethod, type Expense, type Group, type Member, type Payment } from './model'
import { assertSettlement, calculateBalances, money, type PairBalance } from './money'
import { firstName, memberLabels } from './people'
import { firebaseGroupId, launchScreen, routeFrom, urlFor, type GroupView, type Route } from './routing'
import { ActivityFeed, Balances, Expenses } from './screens'
import { Settings, useSettingsRequest, type Theme } from './Settings'
import { Avatar, MemberRoster, Sheet } from './ui'
import { useLedger } from './useLedger'
import { maxPasswordLength } from './vault'

type MemberPage = { kind: 'members' } | { kind: 'member'; member?: Member; self?: boolean }
type Panel =
  | { kind: 'theme' | 'account' | 'switch-group' | 'invite' | 'manage' | 'import' | 'guest-share' | 'add-members' | 'invite-members' | 'member-invites' | 'inbox' | 'discovery' }
  | { kind: 'share'; regenerate?: boolean }
  | { kind: 'remove-member'; member: Member }
  | { kind: 'group'; group?: Group; newId?: string }
  | { kind: 'archive'; id: string; name: string; restore?: boolean }
  | MemberPage
  | { kind: 'expense'; expense?: Expense; date?: string; roster?: MemberPage }
  | { kind: 'payment'; payment?: Payment; pair?: PairBalance }

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

function LegacyAccessForm({ busy, archived, unlock }: { busy: boolean; archived: boolean; unlock: (password: string) => void }) {
  const password = useRef<HTMLInputElement>(null)
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault()
    const value = password.current?.value ?? ''
    if (password.current) password.current.value = ''
    unlock(value)
  }}>
    <label className="field"><span>{archived ? "Group password" : "Current group password"}</span>
      <input ref={password} type="password" autoComplete="off" required maxLength={maxPasswordLength} disabled={busy} />
    </label>
    <button className="button primary" disabled={busy}>{busy ? 'Please wait\u2026' : archived ? 'Open encrypted group' : 'Enable account access'}</button>
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

function GroupAccess({ route, accountId, admin, adminReady, busy, open, unlock, join }: {
  route: Extract<Route, { page: 'group' }>; accountId: string; admin: boolean; adminReady: boolean; busy: boolean;
  open: (group: AccountLedger) => void; unlock: (password: string) => void; join: () => void;
}) {
  const [head, setHead] = useState<GroupHead>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const { id, archived, token } = route
  useEffect(() => {
    if (token || (archived && !admin)) return
    let active = true
    setHead(undefined)
    setError('')
    async function load() {
      const value = await readGroupHead(await firebaseGroupId(id))
      if (!active) return
      if (Boolean(value.archivedAt) !== archived || !value.storage) {
        setHead(value)
        return
      }
      const group = await readCloudGroup(value.id)
      if (!active) return
      if (!('data' in group) || Boolean(group.archivedAt) !== archived) {
        throw new Error('The group status changed. Open it again from its current listing.')
      }
      open(group)
      window.requestAnimationFrame(() => document.getElementById('group-title')?.focus())
    }
    void load().catch(issue => { if (active) setError(accountError(issue)) })
    return () => { active = false }
  }, [id, archived, token, admin, attempt, open])

  if (archived && !admin) return adminReady ? <p className="notice danger" role="alert">This group is unavailable to your account.</p>
    : <p className="loading" role="status">Checking access&hellip;</p>
  if (token) return <section className="auth-card">
    <h1>Join group</h1>
    <p>Accept this invitation to link the group to your signed-in account.</p>
    <button className="button primary" disabled={busy} onClick={join}>{busy ? 'Joining\u2026' : 'Accept invitation'}</button>
  </section>
  if (error) return <div className="form-stack">
    <p className="notice danger" role="alert">{error}</p>
    <button className="text-button" onClick={() => setAttempt(current => current + 1)}>Try again</button>
  </div>
  if (!head) return <div className="loading-skeleton" role="status"><span className="sr-only">Checking group access&hellip;</span><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div>
  if (Boolean(head.archivedAt) !== archived) return <p className="notice" role="status">
    {head.archivedAt ? 'Open this archived group from Platform Admin.' : 'This group has been restored. Open it from My Groups if you are a member.'}
  </p>
  return <section className="auth-card">
    <h1>{head.summary?.name ?? head.legacyName ?? 'Open legacy group'}</h1>
    {archived || head.owner === accountId ? <>
      <p>{archived ? 'Enter the original password to open this legacy archive.'
        : 'Enter the current group password once. After that, the owner and members can open the encrypted ledger by signing in to Tally.'}</p>
      <LegacyAccessForm busy={busy} archived={archived} unlock={unlock} />
    </> : <>
      <p>Ask the group owner to enable account access. You can then open the group with your Tally account.</p>
      <button className="button" onClick={() => setAttempt(current => current + 1)}>Check again</button>
    </>}
  </section>
}

function readGuestRoute() {
  return location.hash.toLowerCase().startsWith('#guest=') ? guestToken(location.href) || 'invalid' : ''
}

export default function App() {
  const auth = useAccount()
  const request = useSettingsRequest()
  const [theme, setTheme] = useState(readTheme)
  const [guestEntry, showGuestEntry] = useState(false)
  const [guest, setGuest] = useState(readGuestRoute)
  useEffect(() => {
    const syncGuest = () => setGuest(readGuestRoute())
    window.addEventListener('hashchange', syncGuest)
    window.addEventListener('popstate', syncGuest)
    return () => { window.removeEventListener('hashchange', syncGuest); window.removeEventListener('popstate', syncGuest) }
  }, [])
  function exitGuest() {
    const next = new URL(location.pathname, location.origin)
    window.history.replaceState(null, '', next)
    setGuest('')
  }
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      const dark = theme === 'dark' || (theme === 'system' && query.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191720' : '#f7f6f9')
    }
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [theme])

  function changeTheme(value: Theme) {
    setTheme(value)
    try { localStorage.setItem('tally:theme', value) } catch { /* Preferences are optional. */ }
  }

  const entry = guestEntry && <GuestEntry close={() => showGuestEntry(false)} open={token => {
    window.history.pushState(null, '', new URL('#guest=' + token, new URL(location.pathname, location.origin)))
    setGuest(token)
    showGuestEntry(false)
  }} />
  if (firebaseConfigured && guest) return <><GuestView key={guest} token={guest} close={exitGuest} retry={() => showGuestEntry(true)} />{entry}</>
  const screen = launchScreen(firebaseConfigured, auth.loading, Boolean(auth.account))
  if (screen === 'dashboard' && auth.account) {
    return <><SignedInApp key={auth.account.id} account={auth.account} theme={theme} changeTheme={changeTheme} viewGuest={() => showGuestEntry(true)} />{entry}</>
  }
  return <main className="layout auth-layout" id="page-content">
    <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally</div>
    {screen === 'loading' ? <div className="loading-skeleton auth-skeleton" role="status"><span className="sr-only">Checking your session&hellip;</span><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" /></div> :
      screen === 'setup' ? <p className="notice" role="status">Set up Firebase Authentication to use this deployment of Tally.</p> :
      auth.error ? <div className="form-stack"><p className="notice danger" role="alert">{auth.error}</p>
        <button className="text-button" onClick={auth.retry}>Try again</button></div> :
      <AuthCard busy={request.busy} error={request.error} run={request.run} clearError={request.clearError} viewGuest={() => showGuestEntry(true)} />}
    {entry}
  </main>
}

function SignedInApp({ account, theme, changeTheme, viewGuest }: {
  account: Account; theme: Theme; changeTheme: (theme: Theme) => void; viewGuest: () => void;
}) {
  const ledger = useLedger(account)
  const { data } = ledger
  const request = useSettingsRequest()
  const [route, setRoute] = useState(() => routeFrom(new URL(location.href)))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState(0)
  const [invitations, setInvitations] = useState<MemberInvite[]>([])
  const [inboxError, setInboxError] = useState('')
  const unread = invitations.filter(item => inviteStatus(item) === 'pending').length
  const [online, setOnline] = useState(() => navigator.onLine)
  const [admin, setAdmin] = useState(false)
  const [adminReady, setAdminReady] = useState(false)
  const expenseMembersButton = useRef<HTMLButtonElement>(null)
  const routeId = route.page === 'group' ? route.id : ''
  const [resolvedRoute, setResolvedRoute] = useState<{ id: string; cloudId: string }>()
  useEffect(() => {
    let mounted = true
    if (routeId) void firebaseGroupId(routeId).then(cloudId => { if (mounted) setResolvedRoute({ id: routeId, cloudId }) })
    return () => { mounted = false }
  }, [routeId])
  const cloudId = resolvedRoute?.id === routeId ? resolvedRoute.cloudId : routeId
  const archived = route.page === 'group' && route.archived
  const group = account.verified && cloudId === ledger.cloud?.id &&
    Boolean(ledger.cloud?.archivedAt) === archived && (!archived || admin) ? data?.groups[0] : undefined
  const members = data?.members ?? []
  const activeMembers = members.filter(member => member.active)
  const memberId = ledger.cloudOwner ? group?.ownerMemberId ?? '' : ledger.cloud?.memberId ?? ''
  const expenses = data?.expenses ?? []
  const payments = data?.payments ?? []
  const { pairs, labels } = useMemo(() => ({
    pairs: calculateBalances(data?.expenses ?? [], data?.payments ?? []), labels: memberLabels(data?.members ?? []),
  }), [data])
  const nameOf = (id: string) => labels.get(id) ?? 'Unknown member'
  const fullNameOf = (id: string) => members.find(member => member.id === id)?.name ?? nameOf(id)
  const canEdit = Boolean(group && ledger.cloudOwner && !archived)
  const busy = request.busy || ledger.working
  const canStartEdit = canEdit && online

  useEffect(() => {
    if (!account.verified) return
    let active = true
    let stop: (() => void) | undefined
    let sequence = 0
    const reload = () => {
      const current = ++sequence
      void receivedInvites(account.email).then(list => {
        if (active && current === sequence) { setInvitations(list); setInboxError('') }
      }).catch(issue => { if (active && current === sequence) setInboxError(accountError(issue)) })
    }
    void watchInbox(account.email, reload).then(unsubscribe => { if (active) stop = unsubscribe; else unsubscribe() }).catch(reload)
    return () => { active = false; stop?.() }
  }, [account.email, account.verified, version])

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

    }
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('hashchange', sync) }
  }, [])

  useEffect(() => {
    if (ledger.cloud && (cloudId !== ledger.cloud.id || Boolean(ledger.cloud.archivedAt) !== archived ||
      (archived && !admin) || !account.verified)) ledger.lock()
  }, [cloudId, archived, admin, account.verified, ledger.cloud])

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

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

    navigate({ ...route, token: '', view, focus })
  }

  function openGroup(id: string, archivedGroup = false, token = '') {

    navigate({ page: 'group', id, archived: archivedGroup, token, view: 'overview' })
  }

  function openInvite(input: string) {
    try {
      const value = input.trim()
      const link = /^[A-Za-z0-9_-]+$/.test(value)
        ? new URL(`?group=${encodeURIComponent(value)}`, location.href) : new URL(value, location.href)
      const target = routeFrom(link)
      if (target.page !== 'group') throw new Error('Enter a valid group invitation link or code.')
      navigate({ ...target, archived: false })
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
    if (canStartEdit) open(activeMembers.length ? { kind: 'expense', date } : { kind: 'members' })
  }

  function changed(next: Panel | null = null) {
    open(next)
    setMessage('Changes saved.')
    setVersion(current => current + 1)
  }

  async function saveGroup(record: Group, original?: Group, newId?: string, ownerName?: string) {
    if (original) {
      await ledger.change(draft => upsert(draft.groups, record), {
        groupId: record.id, entityId: record.id, entity: 'group', title: record.name, action: 'updated',
      })
      changed()
    } else if (newId) {
      await ledger.createGroup({ ...record, id: newId }, ownerName)
      openGroup(newId)
      changed({ kind: 'members' })
    }
  }

  async function saveMember(record: Member, original?: Member, self = false, revokeAccess = false) {
    if (revokeAccess && record.id === group?.ownerMemberId) throw new Error('The group owner must stay on the roster.')
    await ledger.change(draft => {
      upsert(draft.members, record)
      if (self) draft.groups[0].ownerMemberId = record.id
    }, {
      groupId: record.groupId, entityId: record.id, entity: 'member', title: record.name,
      action: !original ? 'created' : record.active === original.active ? 'updated' : record.active ? 'restored' : 'archived',
    }, revokeAccess ? record.id : undefined)
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
  function renderMemberPage(page: MemberPage, navigateMember: (next: MemberPage) => void, showRemove = false) {
    if (page.kind === 'member' && group && canEdit) {
      return <MemberForm member={page.member} group={group} defaultName={page.self ? firstName(account.name).slice(0, 100) : undefined}
        canLink={Boolean(page.member && page.member.id !== group.ownerMemberId)}
        save={async (record, link) => {
          await saveMember(record, page.member, page.self || link)
          navigateMember({ kind: 'members' })
          setMessage('Member saved.')
        }} />
    }
    return <MemberRoster members={members} nameOf={nameOf} ownerMemberId={group?.ownerMemberId}
      add={canEdit && showRemove ? () => open({ kind: 'add-members' }) : undefined}
      remove={canEdit && showRemove ? member => open({ kind: 'remove-member', member }) : undefined}
      addSelf={canEdit && !memberId ? () => navigateMember({ kind: 'member', self: true }) : undefined}
      edit={canEdit ? member => navigateMember({ kind: 'member', member }) : undefined} />
  }

  function renderPanel() {
    if (!panel) return null
    if (panel.kind === 'theme') return <Sheet key="theme" title="Theme" close={close}>
      <Settings theme={theme} changeTheme={changeTheme} />
    </Sheet>
    if (panel.kind === 'account') return <Sheet key="account" title="Account" close={close} busy={busy}>
      {requestError}<AccountPanel account={account} busy={busy} run={request.run} signOut={logOut} />
      {account.verified && <div className="account-tools inline-actions">
        <button className="text-button" onClick={() => open({ kind: 'discovery' })}>Profile discovery</button>
        {!group && <button className="text-button" onClick={() => open({ kind: 'import' })}>Import a legacy group</button>}
        <button className="text-button" onClick={() => { close(); viewGuest() }}>View as guest</button>
      </div>}
    </Sheet>
    if (panel.kind === 'discovery' && account.verified) return <Sheet title="Profile discovery" backLabel="Account" close={() => open({ kind: 'account' })}>
      <DiscoverySettings account={account} />
    </Sheet>
    if (panel.kind === 'inbox' && account.verified) return <Sheet title="Invitations" close={close}>
      <div className="form-stack">
        {inboxError && <p className="notice danger" role="alert">{inboxError}</p>}
        {!inboxError && !invitations.length && <p className="muted">No group invitations yet.</p>}
        {invitations.map(item => <div className="invitation-record" key={item.id}>
          <strong>{item.groupName}</strong>
          <p className="muted invite-status">{inviteStatus(item)}</p>
          {inviteStatus(item) === 'pending' && <button className="text-button" onClick={() => openGroup(item.id, false, item.token)}>Open invitation</button>}
        </div>)}
      </div>
    </Sheet>
    if (panel.kind === "switch-group") return <Sheet title="Switch group" close={close}>
      <MyGroups compact accountId={account.id} version={version} create={close} join={close} open={openGroup} />
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
    if (panel.kind === 'manage' && group && canEdit) return <Sheet key="manage" title="Manage group" close={close}>
      <div className="form-stack">
        <button type="button" className="text-button" onClick={() => open({ kind: 'group', group })}><Pencil size={16} />Edit group</button>
        <button type="button" className="text-button" onClick={() => open({ kind: 'share' })}><Link2 size={16} />Copy invite link</button>
        <button type="button" className="text-button" onClick={() => open({ kind: 'share', regenerate: true })}><RotateCcw size={16} />Regenerate invite link</button>
        <button type="button" className="text-button" onClick={() => open({ kind: 'add-members' })}><Plus size={16} />Add members</button>
        <button type="button" className="text-button" onClick={() => open({ kind: 'members' })}><UsersRound size={16} />Manage or remove members</button>
        <button type="button" className="text-button" onClick={() => open({ kind: 'member-invites' })}><Bell size={16} />Member invitations</button>
        <button type="button" className="text-button" onClick={() => open({ kind: 'guest-share' })}><Eye size={16} />Guest sharing</button>
        <button type="button" className="text-button negative" onClick={() => open({ kind: 'archive', id: group.id, name: group.name })}>
          <Archive size={16} />Archive group
        </button>
      </div>
    </Sheet>
    if (panel.kind === 'guest-share' && data && ledger.cloud && canEdit) return <Sheet title="Guest sharing" close={close}>
      <GuestSharePanel data={data} revision={ledger.cloud.revision} />
    </Sheet>
    if (panel.kind === 'member-invites' && group && canEdit) return <Sheet title="Member invitations" close={close}>
      <MemberInvitationList groupId={group.id} />
    </Sheet>
    if ((panel.kind === "add-members" || panel.kind === "invite-members") && group && canEdit) return <Sheet
      title={panel.kind === "invite-members" ? "Invite members" : "Add members"} close={close} busy={busy}>
      <AddMembers group={group} members={members} saveName={async name => {
        await saveMember({ id: crypto.randomUUID(), groupId: group.id, active: true, name })
        changed({ kind: 'members' })
      }} sendInvite={async choice => {
        const existing = members.find(member => member.id === choice.memberId && member.active && member.id !== group.ownerMemberId)
        if (choice.memberId && !existing) throw new Error('Select an available roster member.')
        const name = choice.name || choice.email.split('@')[0].slice(0, 100)
        const draft: InviteDraft = { email: choice.email, groupName: group.name, memberId: existing?.id ?? crypto.randomUUID(), uid: choice.uid }
        if (existing) await issueMemberInvite(group.id, draft, account)
        else await ledger.change(next => next.members.push({ id: draft.memberId, groupId: group.id, name, active: true }), {
          groupId: group.id, entityId: draft.memberId, entity: 'member', title: name, action: 'created',
        }, undefined, draft)
        return readIssuedInvite(group.id, choice.email)
      }} />
      {panel.kind === "invite-members" && <button className="text-button" onClick={() => open({ kind: "guest-share" })}><Eye size={16} />Share a view-only link</button>}
    </Sheet>
    if (panel.kind === 'share' && group && canEdit) return <Sheet key="share" title={panel.regenerate ? 'Regenerate invite link' : 'Copy invite link'}
      close={close} description={panel.regenerate ? 'A new one-time link replaces any unused link for the selected member.'
        : 'Choose the member who should receive the one-time link.'}>
      <ShareGroup id={group.id} members={members} ownerMemberId={group.ownerMemberId} nameOf={nameOf} regenerate={Boolean(panel.regenerate)} />
    </Sheet>
    if (panel.kind === 'remove-member' && group && canEdit) {
      const { member } = panel
      return <Sheet key="remove-member" title={`Remove ${nameOf(member.id)}?`} close={() => open({ kind: 'members' })} busy={busy}
        description="Their account access and unused invite links are revoked. Existing expenses, payments and balances are kept.">
        {requestError}
        <div className="inline-actions">
          <button type="button" className="button" disabled={busy} onClick={() => open({ kind: 'members' })}>Cancel</button>
          <button type="button" className="button danger-button" disabled={busy} onClick={() => perform(async () => {
            await saveMember({ ...member, active: false }, member, false, true)
            changed({ kind: 'members' })
          })}>Remove member</button>
        </div>
      </Sheet>
    }
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
          save={(record, ownerName) => saveGroup(record, panel.group, panel.newId, ownerName)} />
      </Sheet>
    }
    if (!group) return null
    if (panel.kind === 'members') return <Sheet key="members" title="Group members" close={close}>
      {renderMemberPage(panel, open, true)}
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
    if (panel.kind === 'payment') {
      const { payment, pair } = panel
      return <Sheet key="payment" title={payment ? 'Edit payment' : 'Settle up'} close={close} busy={busy}>
        <PaymentForm group={group} members={members} nameOf={nameOf} expenses={expenses} payments={payments} pair={pair} payment={payment}
          save={record => savePayment(record, payment)} remove={payment ? () => removePayment(payment) : undefined} />
      </Sheet>
    }
    return null
  }

  const screenProps = group && { currency: group.currency, nameOf, expenses, payments, canEdit: canStartEdit, editExpense, editPayment }
  const activeView = route.page === 'group' ? route.view : 'overview'
  const home = urlFor({ page: 'groups' }, new URL(location.href))
  const adminUrl = urlFor({ page: 'admin' }, new URL(location.href))
  const focus = route.page === 'group' ? route.focus : undefined
  const groupHref = (view: GroupView) => route.page === 'group' ? urlFor({ ...route, token: '', view, focus: undefined }, new URL(location.href)).href : home.href
  const settle = (pair: PairBalance) => open({ kind: 'payment', pair })
  return <div className={group ? activeView === "overview" ? "workspace overview-workspace" : "workspace" : undefined}>
    <a className="skip-link" href="#page-content" onClick={event => { event.preventDefault(); document.getElementById('page-content')?.focus() }}>Skip to content</a>
    <header className="site-header">
      <div className={`header-inner${group ? '' : ' without-group'}`}>
        <a className="brand" href={home.href} onClick={event => { event.preventDefault(); navigate({ page: 'groups' }) }} aria-label="Tally, My Groups">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally
        </a>
        {group && <div className="workspace-crumb"><a href={home.href} onClick={event => { event.preventDefault(); navigate({ page: "groups" }) }}>My groups</a><span aria-hidden="true">/</span><strong>{group.name}</strong></div>}
        <nav className="header-actions" aria-label="Main navigation">
          {account.verified && admin && <a className="text-button header-admin" href={adminUrl.href}
            aria-current={route.page === 'admin' ? 'page' : undefined}
            onClick={event => { event.preventDefault(); navigate({ page: 'admin' }) }}>Admin</a>}
          {!group && <button className="text-button header-admin" onClick={() => open({ kind: "account" })}>Account</button>}
          {!group && <button className="icon-button" aria-label="Log out" title="Log out" disabled={busy} onClick={logOut}><LogOut size={17} /></button>}
          {account.verified && <button className="icon-button inbox-button" type="button" aria-label={unread ? 'Invitations, ' + unread + ' pending' : 'Invitations'}
            title="Invitations" onClick={() => open({ kind: 'inbox' })}><Bell size={18} />{unread > 0 && <span aria-hidden="true" />}</button>}
          <button className="icon-button" type="button" aria-label="Theme" title="Theme"
            onClick={() => open({ kind: "theme" })}><SunMoon size={18} /></button>
          {group && <button className="icon-button workspace-account" aria-label="Account" title="Account" onClick={() => open({ kind: "account" })}>{Array.from(account.name || account.email)[0]?.toUpperCase() ?? "A"}</button>}
        </nav>
      </div>
    </header>
    {group && <aside className="workspace-rail">
      <a className="brand" href={home.href} onClick={event => { event.preventDefault(); navigate({ page: "groups" }) }}>
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Tally
      </a>
      <a className="rail-groups" href={home.href} onClick={event => { event.preventDefault(); navigate({ page: "groups" }) }}><House size={18} aria-hidden="true" />All groups</a>
      <GroupNavigation view={activeView} go={go} href={groupHref} />
      {!archived && <button className="rail-switch rail-groups" aria-label="Switch group" onClick={() => open({ kind: "switch-group" })}>
        <span>{group.name}</span><ChevronDown size={15} aria-hidden="true" />
      </button>}
    </aside>}
    <main className={`layout${group ? ' ledger-layout' : ''}`} id="page-content" tabIndex={-1}>
      {!online && <p className="notice neutral" role="status">You’re offline. Reconnect to open groups or save changes.</p>}
      {!panel && requestError}
      {ledger.accessError && !group && <p className="notice danger" role="alert">{ledger.accessError}</p>}
      {!account.verified ? <section className="auth-card">
        <h1>Verify your email</h1><AccountPanel account={account} busy={busy} run={request.run} signOut={logOut} />
      </section> : route.page === 'admin' ? admin ? <PlatformGroups version={version} open={id => openGroup(id, true)}
        archive={record => open({ kind: 'archive', id: record.id, name: record.summary?.name ?? record.legacyName ?? 'This group', restore: Boolean(record.archivedAt) })} />
        : <p className={adminReady ? 'notice danger' : 'loading'} role={adminReady ? 'alert' : 'status'}>
          {adminReady ? 'Platform Admin is unavailable to your account.' : 'Checking access…'}</p>
        : route.page === 'groups' ? <MyGroups accountId={account.id} version={version}
          offline={!online} create={() => open({ kind: "group", newId: cloudGroupId() })}
          join={() => open({ kind: "invite" })} open={openGroup} />
        : !group && <GroupAccess key={`${route.id}:${route.archived}:${route.token}`} route={route} accountId={account.id} admin={admin} adminReady={adminReady} busy={busy}
          open={ledger.openAccountGroup}
          unlock={password => perform(async () => {
            await ledger.unlockGroup(await firebaseGroupId(route.id), password, route.archived)
            if (!route.archived) setMessage('Account access enabled.')
            setVersion(current => current + 1)
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
              <div className="member-preview">
                {!!activeMembers.length && <button type="button" className="people-button avatar-stack" aria-label="Group members" onClick={() => go("people")}>
                  {activeMembers.slice(0, 4).map((member, index) => <Avatar member={member} index={index} key={member.id} />)}
                </button>}
                {canStartEdit && <button type="button" className="avatar-add" aria-label="Add members" title="Add members" onClick={() => open({ kind: 'add-members' })}>
                  <span className="add-person" aria-hidden="true"><Plus size={15} /></span>
                </button>}
              </div>
              <button type="button" className="text-button member-count" onClick={() => go("people")}>
                {activeMembers.length} {activeMembers.length === 1 ? 'member' : 'members'}
              </button>
              <span className="group-meta">&middot; {group.currency} &middot; {archived ? "Archived" : ledger.cloudOwner ? "Owner" : "Member"}</span>
              {archived && <button className="text-button" onClick={() => open({ kind: 'archive', id: group.id, name: group.name, restore: true })}>Restore group</button>}
            </div>
          </div>
          {canStartEdit && <div className="workspace-group-actions">
            <button className="button share-action" aria-label="Share" title="Share" onClick={() => open({ kind: "invite-members" })}><Link2 size={17} /><span>Share</span></button>
            <button className="icon-button" aria-label="Manage group" title="More options" onClick={() => open({ kind: "manage" })}><Ellipsis size={20} /></button>
            <div className="add-expense-dock"><button className="button primary add-expense" onClick={() => startExpense()}><Plus size={20} />Add expense</button></div>
          </div>}
        </section>
        <div key={group.id} className="view">
          {activeView === "overview" && <GroupHome {...screenProps} pairs={pairs} members={members} memberId={memberId}
            events={data?.activity ?? []} go={go} settle={canStartEdit ? settle : undefined} add={canStartEdit ? startExpense : undefined} />}
          {(activeView === "expenses" || activeView === "calendar") && <Expenses key={focus} {...screenProps} memberId={memberId}
            members={members} fullNameOf={fullNameOf} canExport={canEdit} focusTransaction={focus} events={data?.activity ?? []}
            calendar={activeView === "calendar"} changeView={calendar => go(calendar ? "calendar" : "expenses")}
            renderCalendar={(shownExpenses, shownPayments) => <ExpenseCalendar {...screenProps} expenses={shownExpenses}
              payments={shownPayments} events={data?.activity ?? []} memberId={memberId} add={canStartEdit ? startExpense : undefined} />} />}
          {activeView === "balances" && <Balances key={focus} {...screenProps} pairs={pairs} members={members} memberId={memberId} focus={focus} settle={settle} />}
          {activeView === "people" && <People {...screenProps} pairs={pairs} members={members} ownerId={group.ownerMemberId ?? ""}
            memberId={memberId} focus={focus} select={id => go("people", id)} seeBalances={id => go("balances", "member:" + id)}
            manage={canStartEdit ? () => open({ kind: "members" }) : undefined} add={canStartEdit ? () => open({ kind: "add-members" }) : undefined} />}
          {activeView === 'activity' && <ActivityFeed events={data?.activity ?? []} />}
        </div>
      </>}
    </main>
    <p role="status" className="sr-only">{message}</p>
    {account.verified ? renderPanel() : (panel?.kind === 'account' || panel?.kind === 'theme') && renderPanel()}
  </div>
}
