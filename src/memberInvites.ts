import type { Firestore, Timestamp, Transaction } from 'firebase/firestore'
import { codeOf, firebase, type Account } from './firebase'
import { emailKey, newToken } from './guestData'
import { urlFor } from './routing'

type Store = typeof import('firebase/firestore')
export type InviteDraft = { email: string; memberId: string; groupName: string; uid?: string }
export type MemberInvite = {
  id: string; email: string; groupName: string; memberId: string; token: string;
  expiresAt: Timestamp; status: 'pending' | 'accepted' | 'revoked'
}
export type DiscoveryProfile = { uid: string; name: string; email: string; photo: string }
export const inviteEmail = (value: string) => value.trim().toLowerCase()
export const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
export const inviteStatus = (invite: MemberInvite) =>
  invite.status === 'pending' && invite.expiresAt.toMillis() <= Date.now() ? 'expired' : invite.status
export const memberInviteUrl = (group: string, token: string) =>
  urlFor({ page: 'group', id: group, token, view: 'overview', archived: false }, new URL(location.href)).href

export async function prepareInvite(transaction: Transaction, store: Store, db: Firestore, id: string, draft: InviteDraft, account: Account) {
  const email = inviteEmail(draft.email)
  if (!validEmail(email)) throw new Error('Enter a valid email address.')
  if (email === inviteEmail(account.email)) throw new Error('Your account already owns this group.')
  const key = await emailKey(email)
  const group = store.doc(db, 'cloudGroups', id)
  const target = store.doc(group, 'targetInvites', key)
  const link = store.doc(group, 'inviteLinks', draft.memberId)
  const previous = (await transaction.get(target)).data() as MemberInvite | undefined
  if (previous && inviteStatus(previous) === 'pending') throw new Error('This person already has a pending invitation.')
  const linkedEmail = (await transaction.get(store.doc(group, 'linkedEmails', key))).data()?.uid
  const candidate = draft.uid ?? linkedEmail
  if (typeof candidate === 'string' && (await transaction.get(store.doc(group, 'members', candidate))).exists()) {
    throw new Error('This account is already a member of the group.')
  }
  if ((await transaction.get(store.doc(group, 'assignments', draft.memberId))).exists()) {
    throw new Error('This roster member already has a linked account.')
  }
  const current = (await transaction.get(link)).data()?.token
  if (current) {
    const ticket = (await transaction.get(store.doc(group, 'invites', current))).data()
    if (ticket?.target) {
      const other = (await transaction.get(store.doc(group, 'targetInvites', ticket.target))).data() as MemberInvite | undefined
      if (other && other.token === current && inviteStatus(other) === 'pending') {
        throw new Error('Revoke the pending invitation for this roster member before inviting someone else.')
      }
    }
  }
  const token = newToken()
  const expiresAt = store.Timestamp.fromMillis(Date.now() + 7 * 86_400_000)
  const record = { email, groupName: draft.groupName, memberId: draft.memberId, token, expiresAt, status: 'pending' as const }
  return () => {
    transaction.set(target, record)
    transaction.set(store.doc(db, 'memberInboxes', key, 'invitations', id), { token, status: 'pending' })
    transaction.set(store.doc(group, 'invites', token), { memberId: draft.memberId, target: key })
    transaction.set(link, { token })
  }
}

export async function prepareRosterInviteRevocation(transaction: Transaction, store: Store, db: Firestore, id: string, memberId: string) {
  const group = store.doc(db, 'cloudGroups', id)
  const link = (await transaction.get(store.doc(group, 'inviteLinks', memberId))).data()
  if (!link?.token) return
  const ticket = (await transaction.get(store.doc(group, 'invites', link.token))).data()
  if (!ticket?.target) return
  const ref = store.doc(group, 'targetInvites', ticket.target)
  const invite = (await transaction.get(ref)).data()
  if (invite?.token !== link.token || invite?.status !== 'pending') return
  return () => {
    transaction.update(ref, { status: 'revoked' })
    transaction.update(store.doc(db, 'memberInboxes', ticket.target, 'invitations', id), { status: 'revoked' })
  }
}

export async function issueMemberInvite(id: string, draft: InviteDraft, account: Account) {
  const { db, store } = await firebase()
  await store.runTransaction(db, async transaction => {
    const write = await prepareInvite(transaction, store, db, id, draft, account)
    write()
  })
}

export async function readIssuedInvite(id: string, email: string) {
  const { db, store } = await firebase()
  const key = await emailKey(email)
  const ref = store.doc(db, 'cloudGroups', id, 'targetInvites', key)
  return { ...(await store.getDocFromServer(ref)).data(), id: key } as MemberInvite
}

export async function groupInvites(id: string) {
  const { db, store } = await firebase()
  const result = await store.getDocsFromServer(store.collection(db, 'cloudGroups', id, 'targetInvites'))
  return result.docs.map(doc => ({ ...doc.data(), id: doc.id } as MemberInvite))
    .sort((a, b) => b.expiresAt.toMillis() - a.expiresAt.toMillis())
}

export async function revokeMemberInvite(groupId: string, invite: MemberInvite) {
  const { db, store } = await firebase()
  const group = store.doc(db, 'cloudGroups', groupId)
  await store.runTransaction(db, async transaction => {
    const target = store.doc(group, 'targetInvites', invite.id)
    const current = (await transaction.get(target)).data()
    if (current?.token !== invite.token || current.status !== 'pending') throw new Error('This invitation has changed. Open the list again.')
    transaction.update(target, { status: 'revoked' })
    transaction.update(store.doc(db, 'memberInboxes', invite.id, 'invitations', groupId), { status: 'revoked' })
  })
}

export async function watchInbox(email: string, onUpdate: () => void) {
  const { db, store } = await firebase()
  const key = await emailKey(email)
  return store.onSnapshot(store.collection(db, 'memberInboxes', key, 'invitations'), { includeMetadataChanges: true },
    snapshot => { if (!snapshot.metadata.fromCache) onUpdate() }, onUpdate)
}

export async function receivedInvites(email: string) {
  const { db, store } = await firebase()
  const key = await emailKey(email)
  const inbox = await store.getDocsFromServer(store.collection(db, 'memberInboxes', key, 'invitations'))
  const items = await Promise.all(inbox.docs.map(async entry => {
    try {
      const data = (await store.getDocFromServer(store.doc(db, 'cloudGroups', entry.id, 'targetInvites', key))).data()
      return data && data.token === entry.data().token ? { ...data, id: entry.id } as MemberInvite : null
    } catch (error) {
      if (codeOf(error) === 'permission-denied') return null
      throw error
    }
  }))
  return items.filter(item => item !== null).sort((a, b) => b.expiresAt.toMillis() - a.expiresAt.toMillis())
}

const searchName = (name: string) => name.trim().toLowerCase()
const namePrefix = (name: string) => Array.from(searchName(name)).slice(0, 3).join('')
const searchable = (prefix: string) => /^[\p{L}\p{N}]{3}$/u.test(prefix)

export async function ownDiscovery(account: Account) {
  const { db, store } = await firebase()
  const ref = store.doc(db, 'accounts', account.id, 'preferences', 'discovery')
  return (await store.getDocFromServer(ref)).data() as { key: string; prefix: string; name: string } | undefined
}

export async function setDiscovery(account: Account, displayName?: string) {
  const { db, store } = await firebase()
  const ref = store.doc(db, 'accounts', account.id, 'preferences', 'discovery')
  const name = displayName?.trim()
  const prefix = name ? namePrefix(name) : ''
  const key = await emailKey(account.email)
  await store.runTransaction(db, async transaction => {
    const previous = (await transaction.get(ref)).data()
    if (previous && (!name || previous.key !== key)) transaction.delete(store.doc(db, 'discovery', previous.key))
    if (previous?.prefix && (!name || previous.prefix !== prefix || previous.key !== key)) {
      transaction.delete(store.doc(db, 'discoveryNames', previous.prefix, 'profiles', previous.key))
    }
    if (!name) {
      transaction.delete(ref)
      return
    }
    const photo = account.photo?.startsWith('https://lh3.googleusercontent.com/') ? account.photo : ''
    const data = { uid: account.id, name, email: inviteEmail(account.email), searchName: searchName(name), photo }
    transaction.set(store.doc(db, 'discovery', key), data)
    if (searchable(prefix)) transaction.set(store.doc(db, 'discoveryNames', prefix, 'profiles', key), data)
    transaction.set(ref, { key, prefix: searchable(prefix) ? prefix : '', name })
  })
}

export async function findAccounts(term: string) {
  const { db, store } = await firebase()
  const query = searchName(term)
  if (validEmail(query)) {
    const match = await store.getDocFromServer(store.doc(db, 'discovery', await emailKey(query)))
    return match.exists() ? [match.data() as DiscoveryProfile] : []
  }
  const prefix = namePrefix(query)
  if (!searchable(prefix)) return []
  const matches = await store.getDocsFromServer(store.query(store.collection(db, 'discoveryNames', prefix, 'profiles'),
    store.orderBy('searchName'), store.startAt(query), store.endAt(query + '\uf8ff'), store.limit(8)))
  return matches.docs.map(doc => doc.data() as DiscoveryProfile)
}
