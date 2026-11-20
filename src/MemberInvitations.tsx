import { useEffect, useRef, useState } from 'react'
import { Mail } from 'lucide-react'
import { accountError, listLinkedMembers, type Account } from './firebase'
import type { Group, Member } from './model'
import { findAccounts, groupInvites, inviteEmail, inviteStatus, memberInviteUrl, ownDiscovery, revokeMemberInvite,
  setDiscovery, validEmail, type DiscoveryProfile, type MemberInvite } from './memberInvites'
import { CopyField } from './Settings'
import { formatEventTime, nameInitial } from './ui'

type Choice = { email: string; name: string; memberId?: string; uid?: string }

export function AddMembers({ group, members, saveName, sendInvite }: {
  group: Group; members: Member[]; saveName: (name: string) => Promise<void>; sendInvite: (choice: Choice) => Promise<MemberInvite>;
}) {
  const [mode, setMode] = useState<'search' | 'email' | 'name'>('search')
  const [term, setTerm] = useState('')
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState<DiscoveryProfile>()
  const [matches, setMatches] = useState<DiscoveryProfile[]>([])
  const [linked, setLinked] = useState<Set<string> | null>(null)
  const [memberId, setMemberId] = useState('')
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState<MemberInvite>()
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(false)
  const email = chosen?.email ?? inviteEmail(term)
  const candidates = linked ? members.filter(member => member.active && member.id !== group.ownerMemberId && !linked.has(member.id)) : []
  useEffect(() => {
    let active = true
    void listLinkedMembers(group.id).then(value => { if (active) setLinked(value) })
      .catch(issue => { if (active) setError(accountError(issue)) })
    return () => { active = false }
  }, [group.id])

  useEffect(() => {
    if (mode !== 'search' || term.trim().length < 3) return
    let active = true
    const timeout = window.setTimeout(() => {
      setSearching(true)
      void findAccounts(term).then(results => { if (active) { setMatches(results); setSearched(true) } })
        .catch(issue => { if (active) setError(accountError(issue)) })
        .finally(() => { if (active) setSearching(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [term, mode])

  function select(next: typeof mode, profile?: DiscoveryProfile) {
    setChosen(profile)
    setName(profile?.name ?? '')
    setMemberId('')
    setError('')
    setSearching(false)
    setMatches([])
    setSearched(false)
    if (next === 'name' && !validEmail(inviteEmail(term))) setName(term.trim())
    if (next === 'email' && !profile && !validEmail(inviteEmail(term))) setTerm('')
    setMode(next)
  }

  async function confirm() {
    if (request.current) return
    request.current = true
    setError('')
    setPending(true)
    try {
      if (mode === 'name') await saveName(name.trim())
      else setSaved(await sendInvite({ email, name: name.trim(), memberId: memberId || undefined, uid: chosen?.uid }))
    } catch (issue) { setError(accountError(issue)) }
    finally { request.current = false; setPending(false) }
  }

  if (saved) return <div className="form-stack">
    <p role="status">Invitation created for {saved.email}.</p>
    <ManualDelivery groupId={group.id} invite={saved} />
    <button className="text-button" onClick={() => { setSaved(undefined); setTerm(""); select("search") }}>Invite someone else</button>
  </div>

  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (mode !== 'search') void confirm() }}>
    <div className="workspace-segmented" role="group" aria-label="Add members by">
      <button type="button" disabled={pending} aria-pressed={mode === "search" || Boolean(chosen)} onClick={() => select("search")}>Tally users</button>
      <button type="button" disabled={pending} aria-pressed={mode === "email" && !chosen} onClick={() => select("email")}>Invite by email</button>
      <button type="button" disabled={pending} aria-pressed={mode === "name"} onClick={() => select("name")}>Add by name</button>
    </div>
    {mode !== "name" && <label className="field"><span>{mode === "email" ? "Email" : "Search by name or exact email"}</span>
      <input type={mode === 'email' ? 'email' : 'search'} placeholder={mode === 'email' ? undefined : 'Name or email'}
        autoComplete="off" required={mode === 'email'} disabled={pending} value={chosen?.email ?? term}
        onChange={event => {
          if (chosen) { setName(''); setMemberId('') }
          setChosen(undefined); setTerm(event.target.value); setSearched(false); setMatches([]); setSearching(false); setError('')
        }} />
    </label>}
    {mode === 'search' && <>
      {searching && <p className="muted" role="status">Searching discoverable accounts&hellip;</p>}
      {searched && !searching && !matches.length && <p className="muted" role="status">No matching Tally profiles. You can still invite them by email.</p>}
      {matches.length > 0 && <ul className="list-surface discovery-list" aria-label="Matching Tally accounts">
        {matches.map(profile => <li key={profile.uid}><button type="button" onClick={() => select('email', profile)}>
          <span className="avatar tone-neutral" aria-hidden="true">{profile.photo
            ? <img alt="" src={profile.photo} referrerPolicy="no-referrer" /> : nameInitial(profile.name)}</span>
          <span><strong>{profile.name}</strong><small>{profile.email}</small></span>
        </button></li>)}
      </ul>}
    </>}
    {mode === 'email' && <>
      <p className="muted">{chosen ? 'Inviting ' + chosen.name + ' to join with their Tally account.' : 'Invite anyone with an email address. They can create a Tally account when they open the link.'}</p>
      {candidates.length > 0 && <label className="field"><span>Link to an existing roster member</span>
        <select value={memberId} disabled={pending} onChange={event => setMemberId(event.target.value)}>
          <option value="">Add a new roster member</option>
          {candidates.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>}
      {!memberId && <label className="field"><span>Roster name (optional)</span><input maxLength={100} value={name}
        disabled={pending} onChange={event => setName(event.target.value)} /></label>}
    </>}
    {mode === 'name' && <label className="field"><span>Member name</span><input maxLength={100} required value={name}
      disabled={pending} onChange={event => setName(event.target.value)} /></label>}
    {error && <p className="notice danger" role="alert">{error}</p>}
    {mode !== 'search' && <div className="inline-actions">
      <button type="submit" className="button primary" disabled={pending || (mode === 'name' ? !name.trim() : !validEmail(email))}>
        {pending ? 'Saving\u2026' : mode === 'name' ? 'Add member' : 'Create invitation'}
      </button>
    </div>}
  </form>
}

function ManualDelivery({ groupId, invite }: { groupId: string; invite: MemberInvite }) {
  const link = memberInviteUrl(groupId, invite.token)
  const subject = encodeURIComponent('Join ' + invite.groupName + ' on Tally')
  const address = encodeURIComponent(invite.email).replace('%40', '@')
  const body = encodeURIComponent('Join ' + invite.groupName + ' with ' + invite.email + ':\r\n\r\n' + link)
  return <div className="form-stack">
    <p className="muted">This link appears in Invitations for the recipient. Use your email app or copy the link to send it yourself.</p>
    <a className="button" href={`mailto:${address}?subject=${subject}&body=${body}`}><Mail size={16} />Open email app</a>
    <CopyField value={link} label="Joining link" button="Copy invitation" />
  </div>
}

export function MemberInvitationList({ groupId }: { groupId: string }) {
  const [items, setItems] = useState<MemberInvite[]>()
  const [share, showShare] = useState('')
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    void groupInvites(groupId).then(value => { if (active) setItems(value) })
      .catch(issue => { if (active) setError(accountError(issue)) })
    return () => { active = false }
  }, [groupId])
  async function revoke(item: MemberInvite) {
    setError('')
    setWorking(item.id)
    try {
      await revokeMemberInvite(groupId, item)
      setItems(current => current?.map(record => record.id === item.id ? { ...record, status: 'revoked' } : record))
      setNotice('Invitation revoked.')
    } catch (issue) { setError(accountError(issue)) }
    finally { setWorking('') }
  }
  return <div className="form-stack">
    {error && <p className="notice danger" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!items && !error && <p role="status">Loading invitations&hellip;</p>}
    {items?.length === 0 && <p className="muted">No member invitations yet.</p>}
    {items?.map(item => {
      const status = inviteStatus(item)
      return <section className="invitation-record" key={item.id}>
        <strong>{item.email}</strong>
        <p className="muted invite-status">{status}{status === 'pending' && ` · Expires ${formatEventTime(item.expiresAt.toDate().toISOString())}`}</p>
        {status === 'pending' && <>
          <div className="inline-actions">
            <button className="text-button" aria-expanded={share === item.id} onClick={() => showShare(current => current === item.id ? '' : item.id)}>Share link</button>
            <button className="text-button negative" disabled={Boolean(working)} onClick={() => void revoke(item)}>Revoke invitation</button>
          </div>
          {share === item.id && <ManualDelivery groupId={groupId} invite={item} />}
        </>}
      </section>
    })}
  </div>
}

export function DiscoverySettings({ account }: { account: Account }) {
  const [name, setName] = useState(account.name)
  const [linked, setLinked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void ownDiscovery(account).then(value => {
      if (value && active) { setLinked(true); setName(value.name) }
    }).catch(issue => { if (active) setError(accountError(issue)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [account])
  async function change(next?: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await setDiscovery(account, next)
      setLinked(Boolean(next))
      setNotice(next ? 'Your profile is discoverable.' : 'Your profile is now hidden from search.')
    } catch (issue) { setError(accountError(issue)) }
    finally { setBusy(false) }
  }
  return <form className="form-stack" onSubmit={event => { event.preventDefault(); if (name.trim()) void change(name) }}>
    <p>Opt in to show your display name, verified email and available profile photo to signed-in users who search for you.</p>
    <label className="field"><span>Display name</span><input maxLength={100} required value={name} disabled={loading || busy}
      onChange={event => setName(event.target.value)} /></label>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="inline-actions">
      <button className="button primary" disabled={loading || busy}>{linked ? 'Update profile' : 'Make profile discoverable'}</button>
      {linked && <button type="button" className="text-button" disabled={busy} onClick={() => void change()}>Hide profile</button>}
    </div>
  </form>
}
