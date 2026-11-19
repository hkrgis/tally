import { useEffect, useRef, useState } from 'react'
import { accountError, changeGroupArchive, isCloudGroup, readCloudGroup, readGroupHead, saveCloudGroup, summariseGroup, watchGroupHead, type Account, type CloudGroup } from './firebase'
import { parseData, type Activity, type AppData, type Group, type Member } from './model'
import { createGroupKey, decryptGroup, openGroup, parseDirectory, sealGroup } from './vault'

type EventInput = Omit<Activity, 'id' | 'at' | 'actor'>
type Opened = Awaited<ReturnType<typeof openGroup>> & { cloud: CloudGroup }

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function useLedger(account: Account) {
  const workingLock = useRef(false)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [working, setWorking] = useState(false)
  const [accessError, setAccessError] = useState('')
  const cloudOwner = account.verified && opened?.cloud.owner === account.id && !opened.cloud.archivedAt

  useEffect(() => {
    if (!opened) return
    let mounted = true
    let unsubscribe: (() => void) | undefined
    const closeIfCurrent = (message: string) => {
      if (!mounted) return
      setOpened(current => current === opened ? null : current)
      setAccessError(message)
    }
    const lost = () => closeIfCurrent('This group is no longer available to your account.')
    void watchGroupHead(opened.cloud.id, head => {
      if (head.archivedAt !== opened.cloud.archivedAt) {
        lost()
      } else if (head.revision !== opened.cloud.revision) {
        void readCloudGroup(head.id).then(async cloud => {
          if (cloud.archivedAt !== opened.cloud.archivedAt || cloud.entry.salt !== opened.salt) {
            lost()
            return
          }
          const data = await decryptGroup(cloud.entry, opened.key)
          data.groups[0].archived = Boolean(cloud.archivedAt)
          if (mounted) setOpened(current => current === opened ? { ...opened, entry: cloud.entry, data, cloud } : current)
        }).catch(lost)
      }
    }, lost).then(stop => {
      if (mounted) unsubscribe = stop
      else stop()
    }).catch(lost)
    return () => { mounted = false; unsubscribe?.() }
  }, [opened])

  function lock() {
    setOpened(null)
    setAccessError('')
  }

  async function exclusive(work: () => Promise<void>) {
    if (workingLock.current) throw new Error('Wait for the current operation to finish.')
    workingLock.current = true
    setWorking(true)
    try { await work() } finally { workingLock.current = false; setWorking(false) }
  }

  async function unlock(id: string, password: string, allowArchived: boolean) {
    await exclusive(async () => {
      let cloud = await readCloudGroup(id)
      if (cloud.archivedAt && !allowArchived) throw new Error('This group is archived. Open it from Platform Admin.')
      const record = await openGroup(cloud.entry, password)
      const latest = await readGroupHead(id)
      if (latest.revision !== cloud.revision || latest.archivedAt !== cloud.archivedAt) {
        throw new Error('The group changed while unlocking. Try again.')
      }
      if (record.data.groups[0].archived && !cloud.archivedAt && !cloud.summary && !cloud.restoredAt) {
        await changeGroupArchive(id, true, summariseGroup(record.data))
        throw new Error('This legacy group was archived. The platform admin can access or restore it.')
      }
      record.data.groups[0].archived = Boolean(cloud.archivedAt)
      if (!cloud.summary && cloud.owner === account.id && !cloud.archivedAt) {
        cloud = await saveCloudGroup(account, record.data, cloud.entry, cloud.revision)
      }
      setAccessError('')
      setOpened({ ...record, cloud })
    })
  }

  async function storeCloud(draft: AppData, protection: Pick<Opened, 'key' | 'salt'>,
    info?: EventInput, expectedRevision?: string) {
    if (info) draft.activity.push({ ...info, id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'Group owner' })
    const data = parseData(draft)
    const entry = await sealGroup(data, protection)
    try {
      const cloud = await saveCloudGroup(account, data, entry, expectedRevision)
      if (!data.groups[0].archived) setOpened({ ...protection, data, entry, cloud })
    } catch (issue) {
      throw new Error(accountError(issue))
    }
  }

  async function createGroup(group: Group, password: string, ownerName?: string) {
    await exclusive(async () => {
      const owner: Member | undefined = ownerName
        ? { id: crypto.randomUUID(), groupId: group.id, name: ownerName, active: true } : undefined
      const data: AppData = {
        version: 1, groups: [owner ? { ...group, ownerMemberId: owner.id } : group], members: owner ? [owner] : [],
        expenses: [], payments: [], sessions: [], activity: [],
      }
      const protection = await createGroupKey(password)
      const info: EventInput = { entity: 'group', groupId: group.id, entityId: group.id, title: group.name, action: 'created' }
      await storeCloud(data, protection, info)
    })
  }

  async function importGroup(file: File, sourceId: string, password: string) {
    await exclusive(async () => {
      const entries = parseDirectory(JSON.parse(await file.text())).groups
      const source = sourceId.trim()
      const entry = entries.find(group => group.id === source) ?? (!source && entries.length === 1 ? entries[0] : undefined)
      if (!entry) throw new Error('Enter the group code for a group in this file.')
      const { data, key, salt } = await openGroup(entry, password)
      let id = isCloudGroup(entry.id) ? entry.id : `f-${entry.id.toLowerCase()}`
      if (!isCloudGroup(id)) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(entry.id))
        const hex = Array.from(new Uint8Array(digest, 0, 16), octet => octet.toString(16).padStart(2, '0')).join('')
        const segments = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
        id = `f-${segments.join('-')}`
      }
      const group = data.groups[0]
      group.id = id
      for (const table of [data.members, data.expenses, data.payments, data.sessions, data.activity]) {
        for (const record of table) record.groupId = id
      }
      for (const event of data.activity) {
        if (event.entity === 'group' && event.entityId === entry.id) event.entityId = id
      }
      await storeCloud(data, { key, salt })
    })
  }

  async function change(update: (draft: AppData) => void, info: EventInput, password?: string) {
    if (!opened || !cloudOwner || info.groupId !== opened.cloud.id) {
      throw new Error('Open an active group you own before changing records.')
    }
    await exclusive(async () => {
      const draft = structuredClone(opened.data)
      update(draft)
      const protection = password ? await createGroupKey(password) : { key: opened.key, salt: opened.salt }
      await storeCloud(draft, protection, info, opened.cloud.revision)
    })
  }

  return { data: opened?.data ?? null, cloud: opened?.cloud, cloudOwner, accessError, working,
    lock, unlock, change, createGroup, importGroup }
}
