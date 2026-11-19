import { useCallback, useEffect, useRef, useState } from 'react'
import { accountError, changeGroupArchive, isCloudGroup, readCloudGroup, readGroupHead, saveCloudGroup, summariseGroup, watchGroupHead, type Account, type AccountLedger } from './firebase'
import type { InviteDraft } from './memberInvites'
import { parseData, type Activity, type AppData, type Group, type Member } from './model'
import { decryptGroup, openGroup, parseDirectory, sealGroup } from './vault'

type Protection = Pick<Awaited<ReturnType<typeof openGroup>>, 'key' | 'salt'>
type OpenedLedger = AccountLedger & { protection?: Protection }

type EventInput = Omit<Activity, 'id' | 'at' | 'actor'>

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function useLedger(account: Account) {
  const workingLock = useRef(false)
  const [opened, setOpened] = useState<OpenedLedger | null>(null)
  const [working, setWorking] = useState(false)
  const [accessError, setAccessError] = useState('')
  const cloudOwner = account.verified && opened?.owner === account.id && !opened.archivedAt

  useEffect(() => {
    if (!opened) return
    let mounted = true
    let unsubscribe: (() => void) | undefined
    const lost = () => {
      if (!mounted) return
      setOpened(current => current === opened ? null : current)
      setAccessError('This group is no longer available to your account.')
    }
    void watchGroupHead(opened.id, head => {
      if (head.archivedAt !== opened.archivedAt) {
        lost()
      } else if (head.revision !== opened.revision) {
        void readCloudGroup(head.id).then(async cloud => {
          if (cloud.archivedAt !== opened.archivedAt) {
            lost()
            return
          }
          const protection = 'entry' in cloud ? opened.protection : undefined
          if ('entry' in cloud && (!protection || protection.salt !== cloud.entry.salt)) { lost(); return }
          const data = 'data' in cloud ? cloud.data : await decryptGroup(cloud.entry, protection!.key)
          data.groups[0].archived = Boolean(cloud.archivedAt)
          if (mounted) setOpened(current => current === opened ? { ...cloud, data, protection } : current)
        }).catch(lost)
      }
    }, lost).then(stop => {
      if (mounted) unsubscribe = stop
      else stop()
    }).catch(lost)
    return () => { mounted = false; unsubscribe?.() }
  }, [opened])

  const openAccountGroup = useCallback((group: OpenedLedger) => {
    setAccessError('')
    setOpened(group)
  }, [])

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

  async function unlockGroup(id: string, password: string, allowArchived: boolean) {
    await exclusive(async () => {
      const cloud = await readCloudGroup(id)
      if (Boolean(cloud.archivedAt) !== allowArchived) throw new Error('The group status changed. Open it again from its current listing.')
      if ('data' in cloud) {
        openAccountGroup(cloud)
        return
      }
      const { data, key, salt } = await openGroup(cloud.entry, password)
      const latest = await readGroupHead(id)
      if (latest.revision !== cloud.revision || latest.archivedAt !== cloud.archivedAt) {
        throw new Error('The group changed while opening. Try again.')
      }
      if (data.groups[0].archived && !cloud.archivedAt && !cloud.summary && !cloud.restoredAt) {
        if (cloud.owner === account.id) await changeGroupArchive(id, true, summariseGroup(data))
        throw new Error('This legacy group was archived. The platform admin can access or restore it.')
      }
      data.groups[0].archived = Boolean(cloud.archivedAt)
      openAccountGroup({ ...cloud, data, protection: { key, salt } })
    })
  }

  async function storeCloud(draft: AppData, info?: EventInput, expectedRevision?: string, removedMemberId?: string, protection?: Protection, invite?: InviteDraft) {
    if (info) draft.activity.push({ ...info, id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'Group owner' })
    const data = parseData(draft)
    try {
      const encrypted = protection ? await sealGroup(data, protection) : undefined
      const cloud = await saveCloudGroup(account, data, expectedRevision, removedMemberId, encrypted, invite)
      if (!data.groups[0].archived) openAccountGroup({ ...cloud, protection })
    } catch (issue) {
      throw new Error(accountError(issue))
    }
  }

  async function createGroup(group: Group, ownerName?: string) {
    await exclusive(async () => {
      const owner: Member | undefined = ownerName
        ? { id: crypto.randomUUID(), groupId: group.id, name: ownerName, active: true } : undefined
      const data: AppData = {
        version: 1, groups: [owner ? { ...group, ownerMemberId: owner.id } : group], members: owner ? [owner] : [],
        expenses: [], payments: [], sessions: [], activity: [],
      }
      const info: EventInput = { entity: 'group', groupId: group.id, entityId: group.id, title: group.name, action: 'created' }
      await storeCloud(data, info)
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
      await storeCloud(data, undefined, undefined, undefined, { key, salt })
    })
  }

  async function change(update: (draft: AppData) => void, info: EventInput, removedMemberId?: string, invite?: InviteDraft) {
    if (!opened || !cloudOwner || info.groupId !== opened.id) {
      throw new Error('Open an active group you own before changing records.')
    }
    await exclusive(async () => {
      const draft = structuredClone(opened.data)
      update(draft)
      await storeCloud(draft, info, opened.revision, removedMemberId, opened.protection, invite)
    })
  }

  return { data: opened?.data ?? null, cloud: opened, cloudOwner, accessError, working,
    lock, openAccountGroup, unlockGroup, change, createGroup, importGroup }
}
