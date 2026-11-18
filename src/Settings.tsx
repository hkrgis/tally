import { useRef, useState, type FormEvent } from 'react'
import { Download, ExternalLink, Github, Pencil, Plus, RefreshCw, SunMoon, UsersRound } from 'lucide-react'
import { type Group } from './model'
import { download, editUrl, hasRepository, repositoryUrl, serialize } from './storage'
import { errorText, type useLedger } from './useLedger'

export type Theme = 'system' | 'light' | 'dark'
type Ledger = ReturnType<typeof useLedger>

export function Settings({ ledger, group, theme, changeTheme, busy, run, onConnect, onManual, groupForm, members }: {
  ledger: Ledger; group?: Group; theme: Theme; changeTheme: (theme: Theme) => void;
  busy: boolean; run: (work: () => void | Promise<void>) => void;
  onConnect: (token: string) => Promise<void>; onManual: (actor: string) => void;
  groupForm: (group?: Group) => void; members: () => void;
}) {
  const tokenField = useRef<HTMLInputElement>(null)
  const [actor, setActor] = useState('')
  const [confirm, setConfirm] = useState<'reload' | 'close' | null>(null)
  const editor = ledger.editor
  const exportJson = () => {
    if (ledger.data) download('app.json', serialize(ledger.data), 'application/json;charset=utf-8')
  }

  function onGitHub(event: FormEvent) {
    event.preventDefault()
    const token = tokenField.current?.value.trim() ?? ''
    if (tokenField.current) tokenField.current.value = ''
    run(() => {
      if (!/^github_pat_[\w]+$/.test(token)) throw new Error('Enter a fine-grained GitHub token beginning with github_pat_.')
      return onConnect(token)
    })
  }

  return <div className="settings-stack">
    <section className="settings-section">
      <h3><SunMoon size={18} />Appearance</h3>
      <label className="field"><span>Theme</span><select value={theme} onChange={event => changeTheme(event.target.value as Theme)}>
        <option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option>
      </select></label>
    </section>
    <section className="settings-section">
      <h3><Github size={18} />Editor access</h3>
      {editor ? <>
        <p>{editor.mode === 'github' ? `Connected as ${editor.actor}. Changes commit to the GitHub repository.` : `Editing an export draft as ${editor.actor}. Download app.json and commit it through GitHub to publish.`}</p>
        {ledger.conflict && <p className="notice danger" role="alert">The repository changed while you were editing. Download your draft, load the latest ledger, and reapply your changes.</p>}
        {ledger.dirty && <div className="inline-actions">
          {editor.mode === 'github' && <button type="button" className="button primary" onClick={() => run(ledger.commit)} disabled={busy || ledger.conflict}>{ledger.saving ? 'Committing…' : 'Commit to GitHub'}</button>}
          <button type="button" className={`button ${editor.mode === 'manual' ? 'primary' : ''}`} onClick={exportJson}><Download size={16} />Download draft JSON</button>
        </div>}
        {editor.mode === 'manual' && editUrl && <a className="text-button" href={editUrl} target="_blank" rel="noreferrer">Edit app.json on GitHub <ExternalLink size={15} /></a>}
        {editor.mode === 'github' && <button className="text-button" disabled={busy} onClick={() => ledger.dirty ? setConfirm('reload') : run(ledger.reloadRepository)}><RefreshCw size={16} />Load latest repository data</button>}
        <button className="text-button" disabled={busy} onClick={() => ledger.dirty ? setConfirm('close') : run(ledger.closeEditor)}>
          {editor.mode === 'github' ? 'Disconnect GitHub' : 'Close export editor'}
        </button>
        {confirm && <div className="notice danger">
          <p>{confirm === 'reload' ? 'Load the repository version and discard this draft?' : 'Close the editor and discard this draft?'}</p>
          <div className="inline-actions">
            <button className="button danger-button" disabled={busy} onClick={() => run(async () => {
              if (confirm === 'reload') await ledger.reloadRepository()
              else ledger.closeEditor()
              setConfirm(null)
            })}>Discard draft</button>
            <button className="button" onClick={() => setConfirm(null)}>Keep editing</button>
          </div>
        </div>}
      </> : <>
        {hasRepository && <form className="form-stack" onSubmit={onGitHub}>
          <p>Use a fine-grained token for this repository with Contents read and write. The token stays in memory until you disconnect, reload or close this tab.</p>
          <label className="field"><span>GitHub token</span><input type="password" ref={tokenField} autoComplete="off" autoCapitalize="off" spellCheck={false} required /></label>
          <button className="button primary" disabled={busy}>{busy ? 'Please wait…' : 'Connect GitHub'}</button>
        </form>}
        <form className="form-stack export-form" onSubmit={event => { event.preventDefault(); run(() => onManual(actor)) }}>
          <p>Open an export draft to edit here, then download app.json. Publishing requires repository write access or a pull request.</p>
          <label className="field"><span>Editor name</span><input required maxLength={100} value={actor} onChange={event => setActor(event.target.value)} placeholder="Name shown in Activity" /></label>
          <button className="button" disabled={busy || !ledger.data}><Pencil size={16} />Open export editor</button>
        </form>
      </>}
    </section>
    {editor && <section className="settings-section">
      <h3><UsersRound size={18} />Groups</h3>
      <div className="inline-actions">
        <button className="button button-small" onClick={() => groupForm()} disabled={busy}><Plus size={16} />New group</button>
        {group && <button className="button button-small" onClick={() => groupForm(group)} disabled={busy}><Pencil size={15} />Edit group</button>}
        {group && <button className="button button-small" onClick={members} disabled={busy}><UsersRound size={16} />Manage members</button>}
      </div>
    </section>}
    <section className="settings-section">
      <h3><Download size={17} />Ledger data</h3>
      <div className="inline-actions">
        <button className="button button-small" onClick={exportJson} disabled={!ledger.data}><Download size={16} />Download JSON</button>
        <button className="button button-small" onClick={() => run(() => ledger.refresh(ledger.publication?.revision))} disabled={busy}><RefreshCw size={16} />Refresh published data</button>
      </div>
      <p>Published ledger JSON in a public repository is publicly readable. GitHub Pages alone does not provide Google or Gmail signup, password-reset emails, or secure private member accounts.</p>
      {repositoryUrl && <a className="text-button" href={repositoryUrl} target="_blank" rel="noreferrer">View repository and history <ExternalLink size={15} /></a>}
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
