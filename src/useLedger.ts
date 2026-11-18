import { useCallback, useEffect, useRef, useState } from 'react'
import { parseData, type Activity, type AppData } from './model'
import { connectGitHub, readPublished, readRepository, StaleDataError, writeRepository, type GitHubSession } from './storage'

type EventInput = Omit<Activity, 'id' | 'at' | 'actor'>
type Editor =
  | { mode: 'manual'; actor: string; data: AppData }
  | { mode: 'github'; actor: string; data: AppData; sha: string }
type Publication = { revision: string; eventId: string }

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function useLedger() {
  const credentials = useRef<GitHubSession | null>(null)
  const savingLock = useRef(false)
  const refreshSequence = useRef(0)
  const [published, setPublished] = useState<AppData | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [publication, setPublication] = useState<Publication | null>(null)

  const refresh = useCallback(async (revision?: string) => {
    const sequence = ++refreshSequence.current
    setLoadError('')
    try {
      const result = await readPublished(revision)
      if (sequence !== refreshSequence.current) return
      setPublished(result.data)
      setOffline(result.offline)
      if (!result.offline) {
        setPublication(current => current && result.data.revision !== current.revision &&
          !result.data.activity.some(event => event.id === current.eventId) ? current : null)
      }
    } catch (error) {
      if (sequence === refreshSequence.current) setLoadError(errorText(error))
    } finally {
      if (sequence === refreshSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!publication) return
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(publication.revision) }, 15_000)
    const stop = window.setTimeout(() => window.clearInterval(timer), 300_000)
    return () => { window.clearTimeout(stop); window.clearInterval(timer) }
  }, [publication, refresh])

  async function connect(token: string) {
    const result = await connectGitHub(token)
    credentials.current = result.session
    setEditor({ mode: 'github', actor: result.session.actor, ...result.snapshot })
    setDirty(false)
    setConflict(false)
  }

  function beginManual(actor: string) {
    if (!published) throw new Error('Load published data before starting a draft.')
    if (!actor.trim() || actor.trim().length > 100) throw new Error('Enter a name for the activity log (up to 100 characters).')
    setEditor({ mode: 'manual', actor: actor.trim(), data: published })
    setDirty(false)
    setConflict(false)
  }

  function closeEditor() {
    credentials.current = null
    setEditor(null)
    setDirty(false)
    setConflict(false)
    void refresh()
  }

  function change(update: (draft: AppData) => void, info: EventInput) {
    if (!editor || savingLock.current) throw new Error('Open the editor before changing records.')
    const draft = structuredClone(editor.data)
    update(draft)
    draft.revision = crypto.randomUUID()
    draft.activity.push({ ...info, id: crypto.randomUUID(), at: new Date().toISOString(), actor: editor.actor })
    setEditor({ ...editor, data: parseData(draft) })
    setDirty(true)
  }

  async function reloadRepository() {
    const session = credentials.current
    if (!session) return
    const latest = await readRepository(session.token)
    setEditor({ mode: 'github', actor: session.actor, ...latest })
    setDirty(false)
    setConflict(false)
  }

  async function commit() {
    const session = credentials.current
    if (!session || editor?.mode !== 'github' || !dirty || savingLock.current || conflict) return
    const revision = editor.data.revision
    const eventId = editor.data.activity.at(-1)?.id
    if (!revision || !eventId) throw new Error('Save an edit before committing the draft.')
    savingLock.current = true
    setSaving(true)
    try {
      const saved = await writeRepository(session, editor.sha, editor.data)
      setEditor({ mode: 'github', actor: session.actor, ...saved })
      setDirty(false)
      setPublication({ revision, eventId })
      const latest = await readRepository(session.token).catch(() => null)
      if (latest) setEditor({ mode: 'github', actor: session.actor, ...latest })
      await refresh(revision)
    } catch (error) {
      if (error instanceof StaleDataError) setConflict(true)
      throw error
    } finally {
      savingLock.current = false
      setSaving(false)
    }
  }

  return {
    data: editor?.data ?? published, loading, loadError, offline, refresh,
    editor, dirty, saving, conflict, publication, connect, beginManual, closeEditor, change, commit, reloadRepository,
  }
}
