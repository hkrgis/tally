import { useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { errorText } from './useLedger'

export type Theme = 'system' | 'light' | 'dark'

export function Settings({ theme, changeTheme }: { theme: Theme; changeTheme: (theme: Theme) => void }) {
  return <div className="settings-stack">
    <label className="field"><span>Theme</span><select value={theme} onChange={event => changeTheme(event.target.value as Theme)}>
      <option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option>
    </select></label>
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
