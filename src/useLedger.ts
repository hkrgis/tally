import { useCallback, useEffect, useRef, useState } from 'react'
import { accountError, isCloudGroup, saveCloudGroup, type Account, type CloudGroup } from './firebase'
import { parseData, type Activity, type AppData, type Group } from './model'
import { hasRepository, readPublished, readRepository, serialize, StaleDataError } from './storage'
import { createGroupKey, openGroup, sameDirectory, sameEntry, sealGroup, type Directory, type GroupEntry } from './vault'

type EventInput = Omit<Activity, 'id' | 'at' | 'actor'>
type Editor = { actor: string; data: Directory; sha: string | null }
type Opened = Awaited<ReturnType<typeof openGroup>> & { cloud?: CloudGroup }

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function useLedger(account: Account | null) {
  const workingLock = useRef(false)
  const refreshSequence = useRef(0)
  const [published, setPublished] = useState<Directory | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [working, setWorking] = useState(false)
  const [publication, setPublication] = useState<string | null>(null)
  const directory = editor?.data ?? published
  const active = opened && (opened.cloud || sameEntry(directory?.groups.find(group => group.id === opened.entry.id), opened.entry)) ? opened : null
  const cloudOpen = Boolean(active?.cloud)
  const cloudOwner = Boolean(active?.cloud && account?.verified && account.id === active.cloud.owner)

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

  async function latestSnapshot() {
    if (hasRepository) return readRepository()
    if (!published) throw new Error('Load the group data before opening the workspace.')
    return { data: published, sha: null }
  }

  async function beginEditing(actor: string) {
    const name = actor.trim() || 'Organiser'
    if (name.length > 100) throw new Error('Enter a name of up to 100 characters.')
    const snapshot = await latestSnapshot()
    setEditor({ actor: name, ...snapshot })
    setDirty(false)
  }

  function closeEditor() {
    setOpened(null)
    setEditor(null)
    setNames({})
    setDirty(false)
    void refresh()
  }

  async function unlock(entry: GroupEntry, password: string, cloud?: CloudGroup) {
    const record = await openGroup(entry, password)
    if (!cloud && editor && 'name' in entry) {
      // Older envelopes needed the public name to authenticate decryption.
      await storeDraft(editor, record.data, record)
    } else {
      setOpened({ ...record, cloud })
      if (!cloud && editor) setNames(current => ({ ...current, [entry.id]: record.data.groups[0].name }))
    }
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

  async function storeDraft(current: Editor, draft: AppData, protection: Pick<Opened, 'key' | 'salt'>, info?: EventInput) {
    const data = withActivity(draft, current.actor, info)
    const entry = await sealGroup(data, protection)
    const groups = current.data.groups.some(group => group.id === entry.id)
      ? current.data.groups.map(group => group.id === entry.id ? entry : group)
      : [...current.data.groups, entry]
    setEditor({ ...current, data: { version: 2, groups, revision: crypto.randomUUID() } })
    setOpened({ ...protection, data, entry })
    setNames(previous => ({ ...previous, [entry.id]: data.groups[0].name }))
    setDirty(true)
  }

  function withActivity(draft: AppData, actor: string, info?: EventInput) {
    if (info) draft.activity.push({ ...info, id: crypto.randomUUID(), at: new Date().toISOString(), actor })
    return parseData(draft)
  }

  async function storeCloud(current: Account, draft: AppData, protection: Pick<Opened, 'key' | 'salt'>,
    info: EventInput, expectedRevision?: string) {
    const data = withActivity(draft, 'Group owner', info)
    const entry = await sealGroup(data, protection)
    try {
      const cloud = await saveCloudGroup(current, data.groups[0].name, entry, expectedRevision)
      setOpened({ ...protection, data, entry, cloud })
    } catch (issue) {
      throw new Error(accountError(issue))
    }
  }

  async function createGroup(group: Group, password: string) {
    const cloud = isCloudGroup(group.id)
    if (cloud && !account?.verified) throw new Error('Verify your email before creating groups.')
    if (!cloud && !editor) throw new Error('Open the workspace before creating a group.')
    await exclusive(async () => {
      const data: AppData = { version: 1, groups: [group], members: [], expenses: [], payments: [], sessions: [], activity: [] }
      const protection = await createGroupKey(password)
      const info: EventInput = { entity: 'group', groupId: group.id, entityId: group.id, title: group.name, action: 'created' }
      if (cloud && account) await storeCloud(account, data, protection, info)
      else if (editor) await storeDraft(editor, data, protection, info)
    })
  }

  async function change(update: (draft: AppData) => void, info: EventInput, password?: string) {
    if (!active || info.groupId !== active.entry.id || (active.cloud ? !cloudOwner : !editor)) {
      throw new Error('Open a group you can edit before changing records.')
    }
    await exclusive(async () => {
      const draft = structuredClone(active.data)
      update(draft)
      const protection = password ? await createGroupKey(password) : { key: active.key, salt: active.salt }
      if (active.cloud && account) await storeCloud(account, draft, protection, info, active.cloud.revision)
      else if (editor) await storeDraft(editor, draft, protection, info)
    })
  }

  async function reloadRepository() {
    if (!editor) return
    const snapshot = await latestSnapshot()
    setEditor({ actor: editor.actor, ...snapshot })
    setDirty(false)
  }

  async function confirmSaved() {
    if (!editor || !hasRepository || !dirty) return false
    const latest = await readRepository()
    if (!sameDirectory(latest.data, editor.data)) return false
    setEditor({ actor: editor.actor, ...latest })
    setDirty(false)
    if (latest.data.revision) setPublication(latest.data.revision)
    await refresh(latest.data.revision)
    return true
  }

  async function prepareSave() {
    if (!editor || !dirty) return null
    const text = serialize(editor.data)
    if (!hasRepository) return text
    const latest = await readRepository()
    if (latest.sha === editor.sha) return text
    if (sameDirectory(latest.data, editor.data)) {
      setEditor({ actor: editor.actor, ...latest })
      setDirty(false)
      if (latest.data.revision) setPublication(latest.data.revision)
      await refresh(latest.data.revision)
      return null
    }
    throw new StaleDataError()
  }

  return {
    data: active?.data ?? null, directory, names, loading, loadError, offline, refresh,
    editor, dirty, working, publication, beginEditing, closeEditor, change, prepareSave, confirmSaved, reloadRepository,
    unlock, lock, createGroup, cloudOpen, cloudOwner,
  }
}
