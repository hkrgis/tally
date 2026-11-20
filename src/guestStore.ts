import type { DocumentReference, Firestore, Timestamp, Transaction } from 'firebase/firestore'
import { decodeGuest, guestDays, guestParts, maxGuestParts, newToken, tokenPattern } from './guestData'
import { codeOf, firebase } from './firebase'
import { parseData, type AppData } from './model'

type Store = typeof import('firebase/firestore')
export type GuestShare = { token: string; expiresAt: Timestamp }
const badLink = 'This guest link is invalid, expired or revoked. Ask the organiser for a new link.'

export function writeGuestShare(transaction: Transaction, store: Store, db: Firestore, id: string,
  share: GuestShare, revision: string, parts: string[]) {
  const ref = store.doc(db, 'guestShares', share.token)
  transaction.set(ref, { id, revision, partCount: parts.length, expiresAt: share.expiresAt })
  parts.forEach((payload, part) => transaction.set(store.doc(ref, 'parts', String(part)), { part, revision, payload }))
}

export async function readGuestConfig(id: string) {
  const { db, store } = await firebase()
  return (await store.getDocFromServer(store.doc(db, 'guestConfig', id))).data() as GuestShare | undefined
}

export async function manageGuestShare(data: AppData, revision: string, action: 'generate' | 'revoke') {
  const { db, store } = await firebase()
  const { id } = data.groups[0]
  const config = store.doc(db, 'guestConfig', id)
  if (action === 'revoke') {
    await store.deleteDoc(config)
    return undefined
  }
  const share = { token: newToken(), expiresAt: store.Timestamp.fromMillis(Date.now() + guestDays * 86_400_000) }
  const parts = await guestParts(data, share.token, revision)
  await store.runTransaction(db, async transaction => {
    const head = await transaction.get(store.doc(db, 'cloudGroups', id))
    if (head.data()?.revision !== revision) throw new Error('The ledger changed. Try creating the link again.')
    transaction.set(config, share)
    writeGuestShare(transaction, store, db, id, share, revision, parts)
  })
  return share
}

async function readHeader(ref: DocumentReference, store: Store) {
  return (await store.getDocFromServer(ref)).data()
}

export async function readGuest(token: string, cached?: { revision: string; data: AppData }) {
  if (!tokenPattern.test(token)) throw new Error(badLink)
  const { db, store } = await firebase()
  const ref = store.doc(db, 'guestShares', token)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const head = await readHeader(ref, store)
      const count = head?.partCount
      const revision = head?.revision
      if (!head || typeof revision !== 'string' || !Number.isInteger(count) || count < 1 || count > maxGuestParts) throw new Error(badLink)
      if (cached && cached.revision === revision) return { ...cached, expiry: head.expiresAt.toMillis() as number }
      const docs = await Promise.all(Array.from({ length: count }, (_, i) =>
        readHeader(store.doc(ref, 'parts', String(i)), store).catch(error => {
          if (codeOf(error) !== 'permission-denied') throw error
          return undefined
        })))
      const current = await readHeader(ref, store)
      if (!current || current.revision !== revision || docs.some((part, i) => part?.part !== i || part.revision !== revision || typeof part.payload !== 'string')) continue
      const data = parseData(await decodeGuest(docs.map(part => part!.payload), token, revision))
      if (data.groups.length !== 1 || data.groups[0].id !== head.id) throw new Error(badLink)
      return { revision, data, expiry: head.expiresAt.toMillis() as number }
    }
  } catch (error) {
    if (codeOf(error) === 'unavailable') {
      throw new Error('Could not check guest access. Check your connection and try again.')
    }
    throw new Error(badLink)
  }
  throw new Error('The group changed while loading. Try the link again.')
}
