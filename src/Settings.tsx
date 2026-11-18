import { useRef, useState } from 'react'
import { Copy, Download, ExternalLink, Link2, Pencil, Plus, RefreshCw, Save, UsersRound } from 'lucide-react'
import { type Group } from './model'
import { download, editUrl, hasRepository, repositoryUrl } from './storage'
import { errorText, type useLedger } from './useLedger'
import { type GroupEntry } from './vault'

export type Theme = 'system' | 'light' | 'dark'
type Ledger = ReturnType<typeof useLedger>
type Run = (work: () => void | Promise<void>) => void

export function Settings({ theme, changeTheme, refresh, busy }: {
  theme: Theme; changeTheme: (theme: Theme) => void; refresh: () => void; busy: boolean;
}) {
  return <div className="settings-stack">
    <label className="field"><span>Theme</span><select value={theme} onChange={event => changeTheme(event.target.value as Theme)}>
      <option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option>
    </select></label>
    <button className="button button-small" onClick={refresh} disabled={busy}><RefreshCw size={16} />Refresh shared data</button>
  </div>
}

export function Workspace({ ledger, group, busy, run, groupForm, members, unlock, share, save }: {
  ledger: Ledger; group?: Group; busy: boolean; run: Run;
  groupForm: (group?: Group) => void; members: () => void; unlock: (entry: GroupEntry) => void;
  share: () => void; save: () => void;
}) {
  const [actor, setActor] = useState('')
  const [confirmReload, setConfirmReload] = useState(false)

  if (!ledger.editor) return <form className="form-stack" onSubmit={event => {
    event.preventDefault()
    run(() => ledger.beginEditing(actor))
  }}>
    <p className="muted">Work on a copy in this tab. GitHub repository access is required to publish changes.</p>
    <label className="field"><span>Editor name <small>(optional)</small></span><input maxLength={100} value={actor} onChange={event => setActor(event.target.value)}
      disabled={busy} placeholder="Shown in activity" /></label>
    <button className="button primary" disabled={busy || ledger.loading}><Pencil size={16} />{busy ? 'Opening…' : 'Open workspace'}</button>
  </form>

  return <div className="settings-stack">
    <section className="settings-section">
      <h3><UsersRound size={18} />Groups</h3>
      <div className="inline-actions">
        <button className="button button-small" onClick={() => groupForm()} disabled={busy}><Plus size={17} />New group</button>
        {group && <button className="button button-small" onClick={() => groupForm(group)} disabled={busy}><Pencil size={16} />Edit group</button>}
        {group && !group.archived && <button className="button button-small" onClick={members} disabled={busy}>Members</button>}
        {group && <button className="button button-small" onClick={share} disabled={busy}><Link2 size={16} />Share invite</button>}
      </div>
      {(ledger.directory?.groups.length ?? 0) > 0 && <ul className="workspace-groups">
        {ledger.directory?.groups.map(entry => <li key={entry.id}>
          <button className="text-button" disabled={busy || entry.id === group?.id} onClick={() => unlock(entry)}>
            {Object.hasOwn(ledger.names, entry.id) ? ledger.names[entry.id] : `Group ${entry.id.slice(-8)}`}
            {entry.id === group?.id ? ' · Open' : ''}
          </button>
        </li>)}
      </ul>}
    </section>
    <section className="settings-section">
      <h3><Save size={17} />Publishing</h3>
      <div className="inline-actions">
        {ledger.dirty && <button className="button primary" disabled={busy} onClick={save}>Save changes</button>}
        <button className="button button-small" disabled={busy} onClick={() => ledger.dirty ? setConfirmReload(true) : run(ledger.reloadRepository)}>
          <RefreshCw size={16} />Load latest
        </button>
      </div>
      {confirmReload && <div className="notice danger">
        <p>Reloading will discard the changes in this tab.</p>
        <div className="inline-actions">
          <button className="button danger-button" disabled={busy} onClick={() => run(async () => {
            await ledger.reloadRepository()
            setConfirmReload(false)
          })}>Discard and reload</button>
          <button className="button" disabled={busy} onClick={() => setConfirmReload(false)}>Keep editing</button>
        </div>
      </div>}
      {repositoryUrl && <a className="text-button" href={repositoryUrl} target="_blank" rel="noreferrer">Repository history <ExternalLink size={15} /></a>}
    </section>
  </div>
}

export function CopyField({ value, label, button, multiline }: { value: string; label: string; button: string; multiline?: boolean }) {
  const [status, setStatus] = useState('')
  const [showText, setShowText] = useState(!multiline)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('Copied.')
    } catch {
      setShowText(true)
      setStatus('Select the text below and copy it.')
    }
  }
  return <div className="form-stack">
    <div className="inline-actions">
      <button className="button" type="button" onClick={() => void copy()}><Copy size={16} />{button}</button>
      {status && <span className="muted" role="status">{status}</span>}
    </div>
    {showText && <label className="field"><span>{label}</span>
      {multiline ? <textarea rows={3} value={value} readOnly onFocus={event => event.target.select()} />
        : <input value={value} readOnly onFocus={event => event.target.select()} />}
    </label>}
  </div>
}

export function SaveChanges({ contents, busy, dirty, check }: {
  contents: string | null; busy: boolean; dirty: boolean; check: () => Promise<boolean | undefined>;
}) {
  const [status, setStatus] = useState('')
  if (!dirty) return <p className="muted">Your changes have been saved.</p>
  if (!contents) return busy ? <p role="status" className="muted">Checking the latest ledger…</p> : null
  return <div className="form-stack">
    {editUrl ? <>
      <p>Copy the encrypted update, replace the contents of app.json in GitHub, and commit the change.</p>
      <CopyField value={contents} label="Encrypted update" button="Copy update" multiline />
      <a className="button primary" href={editUrl} target="_blank" rel="noreferrer">Open GitHub editor <ExternalLink size={16} /></a>
    </> : <p>Save the encrypted file and replace app.json in the project.</p>}
    <div className="inline-actions">
      <button className="text-button" type="button" onClick={() => download('app.json', contents, 'application/json;charset=utf-8')}><Download size={16} />Save encrypted file</button>
      {hasRepository && <button className="text-button" type="button" disabled={busy} onClick={() => {
        void check().then(saved => {
          if (saved !== undefined) setStatus(saved ? 'Saved on GitHub.' : 'GitHub has not received this update yet.')
        })
      }}>Check save</button>}
    </div>
    {status && <p className="muted" role="status">{status}</p>}
  </div>
}

export function useSettingsRequest() {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(work: () => void | Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try { await work() } catch (issue) { setError(errorText(issue)) }
    finally { setBusy(false); lock.current = false }
  }
  return { busy, error, clearError: () => setError(''), run }
}
