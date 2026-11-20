import { useEffect, useState } from 'react'
import { accountError, getGroupInvitation, listLinkedMembers } from './firebase'
import type { Member } from './model'
import { urlFor } from './routing'
import { CopyField } from './Settings'

export function ShareGroup({ id, members, ownerMemberId, nameOf, regenerate }: {
  id: string; members: Member[]; ownerMemberId?: string; nameOf: (id: string) => string; regenerate: boolean;
}) {
  const [linked, setLinked] = useState<Set<string> | null>(null)
  const [memberId, setMemberId] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void listLinkedMembers(id).then(value => { if (active) setLinked(value) })
      .catch(issue => { if (active) setError(accountError(issue)) })
    return () => { active = false }
  }, [id])

  const options = members.filter(member => member.active && member.id !== ownerMemberId && !linked?.has(member.id))
  const selected = options.find(member => member.id === memberId)?.id ?? (options.length === 1 ? options[0].id : '')
  if (!linked) return error ? <p className="notice danger" role="alert">{error}</p> : <p role="status">Checking members&hellip;</p>
  if (!options.length) return <p className="muted">Add a member without a linked account to share an invitation.</p>
  return <form className="form-stack" onSubmit={async event => {
    event.preventDefault()
    if (busy || !selected) return
    setBusy(true)
    setError('')
    try {
      const token = await getGroupInvitation(id, selected, regenerate)
      setLink(urlFor({ page: 'group', id, token, archived: false, view: 'overview' }, new URL(location.href)).href)
    } catch (issue) { setError(accountError(issue)) }
    finally { setBusy(false) }
  }}>
    <label className="field"><span>Member</span>
      <select aria-label="Member" required disabled={busy} value={selected} onChange={event => {
        setMemberId(event.target.value)
        setLink('')
        setError('')
      }}>
        <option value="">Select a member</option>
        {options.map(member => <option key={member.id} value={member.id}>{nameOf(member.id)}</option>)}
      </select>
    </label>
    <button className="button primary" disabled={busy || Boolean(link)}>
      {busy ? 'Preparing\u2026' : regenerate ? 'Regenerate link' : 'Get invite link'}
    </button>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {link && <CopyField value={link} label="One-time invitation" button="Copy link" />}
  </form>
}

export function ImportGroup({ busy, run, save }: {
  busy: boolean; run: (work: () => Promise<void>) => void; save: (file: File, id: string, password: string) => Promise<void>;
}) {
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get('file')
    if (!(file instanceof File) || !file.size) return
    run(() => save(file, String(form.get('group')), String(form.get('password'))))
  }}>
    <label className="field"><span>Encrypted app.json file</span><input type="file" accept=".json,application/json" name="file" required disabled={busy} /></label>
    <label className="field"><span>Group code (if the file contains multiple groups)</span><input name="group" disabled={busy} /></label>
    <label className="field"><span>Legacy group password</span><input type="password" name="password" autoComplete="off" required disabled={busy} /></label>
    <button className="button primary" disabled={busy}>{busy ? 'Importing…' : 'Import group'}</button>
  </form>
}
