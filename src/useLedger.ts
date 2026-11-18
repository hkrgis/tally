import { useCallback, useEffect, useRef, useState } from 'react'
import { parseData, type Activity, type AppData, type Group } from './model'
import { connectGitHub, readPublished, readRepository, StaleDataError, writeRepository, type GitHubSession } from './storage'
import { createGroupKey, openGroup, sameEntry, sealGroup, type Directory, type GroupEntry } from './vault'

type EventInput = Omit<Activity, 'id' | 'at' | 'actor'>
type Editor =
  | { mode: 'manual'; actor: string; data: Directory }
  | { mode: 'github'; actor: string; data: Directory; sha: string }
type Opened = Awaited<ReturnType<typeof openGroup>>

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function useLedger() {
  const credentials = useRef<GitHubSession | null>(null)
  const workingLock = useRef(false)
  const refreshSequence = useRef(0)
  const [published, setPublished] = useState<Directory | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [dirty, setDirty] = useState(false)
  const [working, setWorking] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [publication, setPublication] = useState<string | null>(null)
  const directory = editor?.data ?? published
  const active = opened && sameEntry(directory?.groups.find(group => group.id === opened.entry.id), opened.entry) ? opened : null

  const refresh = useCallback(async (revision?: string) => {
    const sequence = ++refreshSequence.current
    setLoadError('')
    try {
      const result = await readPublished(revision)
      if (sequence !== refreshSequence.current) return
      setPublished(result.data)
      setOffline(result.offline)
      if (!result.offline && result.data.revision) {
        setPublication(current => current === result.data.revision ? null : current)
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
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(publication) }, 15_000)
    const stop = window.setTimeout(() => window.clearInterval(timer), 300_000)
    return () => { window.clearTimeout(stop); window.clearInterval(timer) }
  }, [publication, refresh])
  useEffect(() => {
    if (opened && !active) setOpened(null)
  }, [opened, active])

  async function connect(token: string) {
    const result = await connectGitHub(token)
    credentials.current = result.session
    setEditor({ mode: 'github', actor: result.session.actor, ...result.snapshot })
    setDirty(false)
    setConflict(false)
  }

  function beginManual(actor: string) {
    if (!published) throw new Error('Load the published directory before starting a draft.')
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

  async function unlock(entry: GroupEntry, password: string) {
    const record = await openGroup(entry, password)
    setOpened(record)
  }

  function lock() {
    setOpened(null)
  }

  async function exclusive(work: () => Promise<void>) {
    if (workingLock.current) throw new Error('Wait for the current operation to finish.')
    workingLock.current = true
    setWorking(true)
    try { await work() } finally { workingLock.current = false; setWorking(false) }
  }

  async function storeDraft(current: Editor, draft: AppData, info: EventInput, protection: Pick<Opened, 'key' | 'salt'>) {
    draft.activity.push({ ...info, id: crypto.randomUUID(), at: new Date().toISOString(), actor: current.actor })
    const data = parseData(draft)
    const entry = await sealGroup(data, protection)
    const groups = current.data.groups.some(group => group.id === entry.id)
      ? current.data.groups.map(group => group.id === entry.id ? entry : group)
      : [...current.data.groups, entry]
    setEditor({ ...current, data: { version: 2, groups, revision: crypto.randomUUID() } })
    setOpened({ ...protection, data, entry })
    setDirty(true)
  }

  async function createGroup(group: Group, password: string) {
    if (!editor) throw new Error('Open the admin editor before creating a group.')
    await exclusive(async () => {
      const data: AppData = { version: 1, groups: [group], members: [], expenses: [], payments: [], sessions: [], activity: [] }
      const protection = await createGroupKey(password)
      await storeDraft(editor, data, { entity: 'group', groupId: group.id, entityId: group.id, title: group.name, action: 'created' }, protection)
    })
  }

  async function change(update: (draft: AppData) => void, info: EventInput, password?: string) {
    if (!editor || !active || info.groupId !== active.entry.id) throw new Error('Unlock the group in the admin editor before changing records.')
    await exclusive(async () => {
      const draft = structuredClone(active.data)
      update(draft)
      const protection = password ? await createGroupKey(password) : { key: active.key, salt: active.salt }
      await storeDraft(editor, draft, info, protection)
    })
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
    if (!session || editor?.mode !== 'github' || !dirty || conflict) return
    const revision = editor.data.revision
    if (!revision) throw new Error('Save an edit before committing the draft.')
    await exclusive(async () => {
      try {
        const saved = await writeRepository(session, editor.sha, editor.data)
        setEditor({ mode: 'github', actor: session.actor, ...saved })
        setDirty(false)
        setPublication(revision)
        const latest = await readRepository(session.token).catch(() => null)
        if (latest) setEditor({ mode: 'github', actor: session.actor, ...latest })
        await refresh(revision)
      } catch (error) {
        if (error instanceof StaleDataError) setConflict(true)
        throw error
      }
    })
  }

  return {
    data: active?.data ?? null, directory, loading, loadError, offline, refresh,
    editor, dirty, working, conflict, publication, connect, beginManual, closeEditor, change, commit, reloadRepository,
    unlock, lock, createGroup,
  }
}
