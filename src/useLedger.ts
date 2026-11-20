import { useCallback, useEffect, useRef, useState } from 'react'
import { accountError, codeOf, readCloudGroup, readGroupHead, saveCloudGroup, watchGroupHead, type Account, type AccountLedger } from './firebase'
import type { InviteDraft } from './memberInvites'
import { parseData, type Activity, type AppData, type Group, type Member } from './model'
import { firebaseGroupId } from './routing'
import { createAccountGroupKey, decryptGroup, openGroup, parseDirectory, sealGroup, type GroupKey } from './vault'

type EventInput = Omit<Activity, 'id' | 'at' | 'actor'>

export const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Try again.'

export function useLedger(account: Account) {
  const workingLock = useRef(false)
  const [opened, setOpened] = useState<AccountLedger | null>(null)
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
          const protection = 'entry' in cloud ? opened.protection : cloud.protection
          if ('entry' in cloud && (!protection || protection.salt !== cloud.entry.salt)) { lost(); return }
          const data = 'data' in cloud ? cloud.data : await decryptGroup(cloud.entry, protection!.key)
          data.groups[0].archived = Boolean(cloud.archivedAt)
          if (mounted) setOpened(current => current === opened ? { ...cloud, data, protection } : current)
        }).catch(issue => { if (codeOf(issue) !== 'unavailable') lost() })
      }
    }, lost).then(stop => {
      if (mounted) unsubscribe = stop
      else stop()
    }).catch(issue => { if (codeOf(issue) !== 'unavailable') lost() })
    return () => { mounted = false; unsubscribe?.() }
  }, [opened])

  const openAccountGroup = useCallback((group: AccountLedger) => {
    setAccessError('')
    setOpened(group)
  }, [])

  function lock() {
    setOpened(null)
    setAccessError('')
  }

  async function exclusive(work: () => Promise<void>) {
    if (!navigator.onLine) throw new Error('Reconnect to continue. Your changes have not been saved.')
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
      if (!allowArchived && cloud.owner !== account.id) throw new Error('Ask the owner to enable account access for this group.')
      const { data, key, salt } = await openGroup(cloud.entry, password)
      const latest = await readGroupHead(id)
      if (latest.revision !== cloud.revision || latest.archivedAt !== cloud.archivedAt) {
        throw new Error('The group changed while opening. Try again.')
      }
      if (data.groups[0].archived && !cloud.archivedAt && !cloud.restoredAt) {
        throw new Error('This legacy group was archived. Ask the platform admin to register its archived status before opening it.')
      }
      data.groups[0].archived = Boolean(cloud.archivedAt)
      if (allowArchived) {
        openAccountGroup({ ...cloud, data, protection: { key, salt } })
        return
      }
      const { protection, encoded } = await createAccountGroupKey()
      await storeCloud(data, undefined, cloud.revision, undefined, protection, undefined, encoded)
    })
  }

  async function storeCloud(draft: AppData, info?: EventInput, expectedRevision?: string, removedMemberId?: string, protection?: GroupKey, invite?: InviteDraft, newAccountKey?: string) {
    if (info) draft.activity.push({ ...info, id: crypto.randomUUID(), at: new Date().toISOString(), actor: 'Group owner' })
    const data = parseData(draft)
    try {
      const encrypted = protection ? await sealGroup(data, protection) : undefined
      const cloud = await saveCloudGroup(account, data, expectedRevision, removedMemberId, encrypted, invite, newAccountKey)
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
      const id = await firebaseGroupId(entry.id)
      const group = data.groups[0]
      group.id = id
      for (const table of [data.members, data.expenses, data.payments, data.sessions, data.activity]) {
        for (const record of table) record.groupId = id
      }
      for (const event of data.activity) {
        if (event.entity === 'group' && event.entityId === entry.id) event.entityId = id
      }
      if (group.archived) await storeCloud(data, undefined, undefined, undefined, { key, salt })
      else {
        const { protection, encoded } = await createAccountGroupKey()
        await storeCloud(data, undefined, undefined, undefined, protection, undefined, encoded)
      }
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
