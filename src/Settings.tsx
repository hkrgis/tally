import { useRef, useState, type FormEvent } from 'react'
import { Download, ExternalLink, Github, KeyRound, Pencil, Plus, RefreshCw, UsersRound } from 'lucide-react'
import { type Group } from './model'
import { download, editUrl, hasRepository, repositoryUrl, serialize } from './storage'
import { errorText, type useLedger } from './useLedger'

export type Theme = 'system' | 'light' | 'dark'
type Ledger = ReturnType<typeof useLedger>

export function Settings({ theme, changeTheme, refresh, busy }: {
  theme: Theme; changeTheme: (theme: Theme) => void; refresh: () => void; busy: boolean;
}) {
  return <div className="settings-stack">
    <label className="field"><span>Theme</span><select value={theme} onChange={event => changeTheme(event.target.value as Theme)}>
      <option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option>
    </select></label>
    <button className="button button-small" onClick={refresh} disabled={busy}><RefreshCw size={16} />Refresh published groups</button>
    <p className="muted">Group names are listed publicly. Group passwords unlock the encrypted records shared with members.</p>
  </div>
}

export function Admin({ ledger, group, busy, run, groupForm, members }: {
  ledger: Ledger; group?: Group; busy: boolean; run: (work: () => void | Promise<void>) => void;
  groupForm: (group?: Group) => void; members: () => void;
}) {
  const tokenField = useRef<HTMLInputElement>(null)
  const [actor, setActor] = useState('')
  const [mode, setMode] = useState<'github' | 'manual'>(hasRepository ? 'github' : 'manual')
  const [confirm, setConfirm] = useState<'reload' | 'close' | null>(null)
  const editor = ledger.editor
  const exportJson = () => {
    if (ledger.directory) download('app.json', serialize(ledger.directory), 'application/json;charset=utf-8')
  }

  function onGitHub(event: FormEvent) {
    event.preventDefault()
    const token = tokenField.current?.value.trim() ?? ''
    if (tokenField.current) tokenField.current.value = ''
    run(() => {
      if (!/^github_pat_[\w]+$/.test(token)) throw new Error('Enter a fine-grained GitHub token beginning with github_pat_.')
      return ledger.connect(token)
    })
  }

  if (!editor) return <div className="settings-stack admin-signin">
    {hasRepository && <div className="mode-picker" aria-label="Admin workflow" role="group">
      <button type="button" className="button" aria-pressed={mode === 'github'} disabled={busy} onClick={() => setMode('github')}><Github size={17} />GitHub</button>
      <button type="button" className="button" aria-pressed={mode === 'manual'} disabled={busy} onClick={() => setMode('manual')}><Download size={17} />Export draft</button>
    </div>}
    {mode === 'github' ? <form className="form-stack" onSubmit={onGitHub}>
      <p className="muted">Use a fine-grained token for this repository with Contents read and write. Tally keeps it in memory during this tab session.</p>
      <label className="field"><span>GitHub token</span><input type="password" ref={tokenField} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy} required /></label>
      <button className="button primary" disabled={busy}><Github size={17} />{busy ? 'Connecting…' : 'Connect GitHub'}</button>
    </form> : <form className="form-stack" onSubmit={event => { event.preventDefault(); run(() => ledger.beginManual(actor)) }}>
      <p className="muted">Edit a draft in this tab and download an encrypted JSON file. Publishing requires a commit or pull request on GitHub.</p>
      <label className="field"><span>Editor name</span><input required maxLength={100} value={actor} onChange={event => setActor(event.target.value)} placeholder="Shown in group activity" /></label>
      <button className="button primary" disabled={busy || !ledger.directory}><Pencil size={17} />Open export editor</button>
    </form>}
    <p className="muted admin-caption"><KeyRound size={16} />Group passwords open records. GitHub access authorises publishing.</p>
  </div>

  return <div className="settings-stack">
    <section className="settings-section">
      <h3><UsersRound size={18} />Groups</h3>
      <div className="inline-actions">
        <button className="button primary" onClick={() => groupForm()} disabled={busy}><Plus size={17} />New group</button>
        {group && <button className="button" onClick={() => groupForm(group)} disabled={busy}><Pencil size={16} />Edit group</button>}
        {group && !group.archived && <button className="button" onClick={members} disabled={busy}><UsersRound size={17} />Manage members</button>}
      </div>
    </section>
    <section className="settings-section">
      <h3><Github size={18} />{ledger.dirty ? 'Unpublished draft' : 'Publishing'}</h3>
      <p>{editor.mode === 'github' ? `Connected as ${editor.actor}. Commit your draft when it’s ready to share.`
        : `Export editor · ${editor.actor}. Download app.json when your draft is ready.`}</p>
      {ledger.conflict && <p className="notice danger" role="alert">The repository changed. Download your draft, load the latest groups, and reapply your edits.</p>}
      <div className="inline-actions">
        {ledger.dirty && editor.mode === 'github' && <button type="button" className="button primary" onClick={() => run(ledger.commit)}
          disabled={busy || ledger.conflict}>{ledger.working ? 'Committing…' : 'Commit to GitHub'}</button>}
        <button type="button" className="button" onClick={exportJson}><Download size={16} />{ledger.dirty ? 'Download encrypted draft' : 'Download encrypted JSON'}</button>
      </div>
      {editor.mode === 'manual' && editUrl && <a className="text-button" href={editUrl} target="_blank" rel="noreferrer">Edit app.json on GitHub <ExternalLink size={15} /></a>}
    </section>
    <section className="settings-section">
      <h3><KeyRound size={17} />Editor session</h3>
      <div className="inline-actions">
        {editor.mode === 'github' && <button className="button button-small" disabled={busy} onClick={() => ledger.dirty ? setConfirm('reload') : run(ledger.reloadRepository)}>
          <RefreshCw size={16} />Load latest from GitHub
        </button>}
        <button className="button button-small" disabled={busy} onClick={() => ledger.dirty ? setConfirm('close') : run(ledger.closeEditor)}>
          {editor.mode === 'github' ? 'Disconnect GitHub' : 'Close export editor'}
        </button>
      </div>
      {confirm && <div className="notice danger">
        <p>{confirm === 'reload' ? 'Load the repository version and discard this draft?' : 'Close the editor and discard this draft?'}</p>
        <div className="inline-actions">
          <button className="button danger-button" disabled={busy} onClick={() => run(async () => {
            if (confirm === 'reload') await ledger.reloadRepository()
            else ledger.closeEditor()
            setConfirm(null)
          })}>Discard draft</button>
          <button className="button" disabled={busy} onClick={() => setConfirm(null)}>Keep editing</button>
        </div>
      </div>}
      {repositoryUrl && <a className="text-button" href={repositoryUrl} target="_blank" rel="noreferrer">Repository and history <ExternalLink size={15} /></a>}
    </section>
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
