import { useState } from 'react'
import { accountError, createGroupInvitation } from './firebase'
import type { Member } from './model'
import { urlFor } from './routing'
import { CopyField } from './Settings'

export function ShareGroup({ id, members, ownerMemberId, nameOf }: {
  id: string; members: Member[]; ownerMemberId?: string; nameOf: (id: string) => string;
}) {
  const [memberId, setMemberId] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = members.filter(member => member.active && member.id !== ownerMemberId)
  if (!options.length) return <p className="muted">Add a member before creating an invitation.</p>
  return <form className="form-stack" onSubmit={async event => {
    event.preventDefault()
    if (busy || !memberId) return
    setBusy(true)
    setError('')
    try {
      const token = await createGroupInvitation(id, memberId)
      setLink(urlFor({ page: 'group', id, token, archived: false, view: 'overview' }, new URL(location.href)).href)
    } catch (issue) { setError(accountError(issue)) }
    finally { setBusy(false) }
  }}>
    <label className="field"><span>Member</span>
      <select aria-label="Member" required disabled={busy} value={memberId} onChange={event => {
        setMemberId(event.target.value)
        setLink('')
        setError('')
      }}>
        <option value="">Select a member</option>
        {options.map(member => <option key={member.id} value={member.id}>{nameOf(member.id)}</option>)}
      </select>
    </label>
    <button className="button primary" disabled={busy || Boolean(link)}>{busy ? 'Creating…' : 'Create invitation'}</button>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {link && <CopyField value={link} label="One-time invitation" button="Copy invitation" />}
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
    <label className="field"><span>Group password</span><input type="password" name="password" autoComplete="off" required disabled={busy} /></label>
    <button className="button primary" disabled={busy}>{busy ? 'Importing…' : 'Import group'}</button>
  </form>
}
