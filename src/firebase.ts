import { memberBalance, calculateBalances } from './money'
import type { AppData } from './model'
import { StaleDataError } from './storage'
import { parseDirectory, type GroupEntry } from './vault'

const emulator = import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === 'true' ||
  import.meta.env.MODE === 'emulator' && import.meta.env.VITE_FIREBASE_EMULATORS === 'true'
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
export const firebaseConfigured = emulator || Object.values(config).every(Boolean)
export const accountPasswordLength = 8
const partSize = 500_000
const maxParts = 12
const cloudIdPattern = /^f-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export type Account = { id: string; email: string; name: string; verified: boolean }
export type GroupSummary = {
  name: string; currency: string; memberCount: number; lastActivityAt: string;
  ownerMemberId: string; createdOn?: string;
}
export type GroupHead = {
  id: string; owner: string; revision: string; partCount: number; summary?: GroupSummary;
  createdAt?: string; archivedAt?: string; archivedBy?: string; restoredAt?: string; legacyName?: string;
}
export type CloudGroup = GroupHead & { entry: GroupEntry; memberId: string }
export type GroupRole = 'owned' | 'joined'
export type AccountGroup = GroupHead & { name: string; balance?: number }

export const cloudGroupId = () => `f-${crypto.randomUUID()}`
export const isCloudGroup = (id: string) => cloudIdPattern.test(id)

async function initialise() {
  if (!firebaseConfigured) throw new Error('Accounts are not set up for this deployment.')
  const [appApi, authApi, store] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')])
  const previous = appApi.getApps().find(app => app.name === 'tally')
  const app = previous ?? appApi.initializeApp(emulator ? {
    apiKey: 'fake-api-key', authDomain: 'demo-tally.firebaseapp.com', projectId: 'demo-tally', appId: '1:123456789:web:audit',
  } : config, 'tally')
  const auth = previous ? authApi.getAuth(app) : authApi.initializeAuth(app, { persistence: [authApi.indexedDBLocalPersistence, authApi.browserLocalPersistence, authApi.browserSessionPersistence] })
  const db = previous ? store.getFirestore(app) : store.initializeFirestore(app, { localCache: store.memoryLocalCache() })
  if (emulator && !previous) {
    authApi.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    store.connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  return { auth, authApi, db, store }
}

let services: ReturnType<typeof initialise> | undefined
function firebase() {
  return services ??= initialise().catch(error => { services = undefined; throw error })
}

export async function observeAccount(onChange: (account: Account | null) => void) {
  const { auth, authApi } = await firebase()
  return authApi.onIdTokenChanged(auth, user => onChange(user ? {
    id: user.uid, email: user.email ?? '', name: user.displayName?.trim() ?? '', verified: user.emailVerified,
  } : null))
}

function returnSettings() {
  return { url: new URL(window.location.pathname, window.location.origin).href }
}

function codeOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

export function accountError(error: unknown) {
  switch (codeOf(error)) {
    case 'auth/email-already-in-use': return 'Use Log In or Forgot password to continue with this email.'
    case 'auth/invalid-email': return 'Enter a valid email address.'
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'Check the email and password and try again.'
    case 'auth/weak-password': return 'Choose a stronger password.'
    case 'auth/password-does-not-meet-requirements': return `Use a password with at least ${accountPasswordLength} characters.`
    case 'auth/operation-not-allowed': return 'Enable Email/Password in Firebase Authentication.'
    case 'auth/popup-blocked': return 'Allow pop-ups for Tally, then try Google sign-in again.'
    case 'auth/popup-closed-by-user': return 'Google sign-in was canceled. Try again or sign in with your email.'
    case 'auth/account-exists-with-different-credential': return 'This email already has an account. Sign in with the original method to open your groups.'
    case 'auth/unauthorized-domain': return 'This siteâ€™s domain must be authorized in Firebase to use Google sign-in.'
    case 'auth/unauthorized-continue-uri': return 'Add this siteâ€™s domain to Firebase Authenticationâ€™s authorised domains.'
    case 'auth/too-many-requests': return 'Too many attempts. Try again later.'
    case 'auth/network-request-failed': return 'Could not reach Firebase. Check your connection and try again.'
    case 'permission-denied': return 'This group or action is unavailable to your account. Ask the organiser for a new invitation if needed.'
    default: return error instanceof Error ? error.message : 'Something went wrong. Try again.'
  }
}

export async function registerAccount(email: string, password: string) {
  const { auth, authApi } = await firebase()
  const result = await authApi.createUserWithEmailAndPassword(auth, email, password)
  await authApi.sendEmailVerification(result.user, returnSettings())
}

export async function signInAccount(email: string, password: string) {
  const { auth, authApi } = await firebase()
  await authApi.signInWithEmailAndPassword(auth, email, password)
}

export async function signInWithGoogle() {
  const { auth, authApi } = await firebase()
  const provider = new authApi.GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  try {
    await authApi.signInWithPopup(auth, provider, authApi.browserPopupRedirectResolver)
  } catch (error) {
    if (codeOf(error) === 'auth/operation-not-allowed') {
      throw new Error('Google sign-in is unavailable. Please sign in with your email.')
    }
    throw error
  }
}

export async function signOutAccount() {
  const { auth, authApi } = await firebase()
  await authApi.signOut(auth)
}

export async function sendResetEmail(email: string) {
  const { auth, authApi } = await firebase()
  try {
    await authApi.sendPasswordResetEmail(auth, email, returnSettings())
  } catch (error) {
    if (codeOf(error) !== 'auth/user-not-found') throw error
  }
}

export async function resendVerification() {
  const { auth, authApi } = await firebase()
  if (!auth.currentUser) throw new Error('Sign in to verify your email.')
  await authApi.sendEmailVerification(auth.currentUser, returnSettings())
}

export async function checkVerification() {
  const { auth, authApi } = await firebase()
  if (!auth.currentUser) throw new Error('Sign in to verify your email.')
  await authApi.reload(auth.currentUser)
  await auth.currentUser.getIdToken(true)
  if (!auth.currentUser.emailVerified) throw new Error('Open the verification email first, then try again.')
}

export async function isAccountAdmin(accountId: string) {
  const { db, store } = await firebase()
  return (await store.getDoc(store.doc(db, 'accountAdmins', accountId))).data()?.enabled === true
}

export async function isPlatformAdmin() {
  const { db, store } = await firebase()
  try {
    return (await store.getDocFromServer(store.doc(db, 'platformAdmin', 'identity'))).exists()
  } catch (error) {
    if (codeOf(error) === 'permission-denied') return false
    throw error
  }
}

function readSummary(value: unknown): GroupSummary | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { name, currency, memberCount, lastActivityAt, ownerMemberId, createdOn } = value as Partial<GroupSummary>
  if (typeof name !== 'string' || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
    typeof memberCount !== 'number' || !Number.isSafeInteger(memberCount) || memberCount < 0 ||
    typeof ownerMemberId !== 'string') return undefined
  const validDate = (stamp: unknown) => typeof stamp === 'string' && Number.isFinite(Date.parse(stamp)) ? stamp : undefined
  return { name, currency, memberCount, ownerMemberId, lastActivityAt: validDate(lastActivityAt) ?? '', createdOn: validDate(createdOn) }
}

function consistentHead(id: string, value: Record<string, unknown>): GroupHead {
  const { owner, revision, partCount, summary, createdAt, archivedAt, archivedBy, restoredAt, legacyName } = value
  if (typeof owner !== 'string' || typeof revision !== 'string' || typeof partCount !== 'number' ||
      !Number.isInteger(partCount) || partCount < 1 || partCount > maxParts) throw new Error('The stored group is incomplete.')
  function date(field: unknown) {
    return field && typeof field === 'object' && 'toDate' in field && typeof field.toDate === 'function'
      ? (field.toDate() as Date).toISOString() : undefined
  }
  return { id, owner, revision, partCount, summary: readSummary(summary),
    createdAt: date(createdAt), archivedAt: date(archivedAt), restoredAt: date(restoredAt), archivedBy: typeof archivedBy === 'string' ? archivedBy : undefined, legacyName: typeof legacyName === 'string' ? legacyName : undefined }
}

export function summariseGroup(data: AppData): GroupSummary {
  const group = data.groups[0]
  const createdOn = data.activity.filter(item => item.entity === 'group' && item.action === 'created')
    .reduce((oldest, item) => !oldest || item.at < oldest ? item.at : oldest, '')
  return {
    ...(createdOn ? { createdOn } : {}),
    name: group.name, currency: group.currency, ownerMemberId: group.ownerMemberId ?? '',
    memberCount: data.members.filter(member => member.active).length,
    lastActivityAt: data.activity.reduce((latest, item) => item.at > latest ? item.at : latest, ''),
  }
}

export async function listAccountGroups(accountId: string, role: GroupRole): Promise<AccountGroup[]> {
  const { db, store } = await firebase()
  const index = role === 'owned' ? 'groups' : 'joined'
  const listing = await store.getDocsFromServer(store.collection(db, 'accounts', accountId, index)).catch(error => {
    if (codeOf(error) === 'permission-denied') {
      throw new Error(`Firestore blocked access to your ${role} groups. Ask the site administrator to check the deployed Firestore rules.`)
    }
    throw error
  })
  const groups = await Promise.all(listing.docs.map(async (reference): Promise<AccountGroup | null> => {
    try {
      const target = store.doc(db, 'cloudGroups', reference.id)
      const doc = await store.getDocFromServer(target)
      if (!doc.exists()) return null
      const head = consistentHead(doc.id, doc.data())
      if (head.archivedAt) return null
      if ((head.owner === accountId) !== (role === 'owned')) return null
      const memberId = role === 'owned' ? head.summary?.ownerMemberId ?? '' :
        (await store.getDocFromServer(store.doc(target, 'members', accountId))).data()?.memberId
      if (role === 'joined' && typeof memberId !== 'string') return null
      const stats = memberId ? (await store.getDocFromServer(store.doc(target, 'stats', 'current'))).data() : undefined
      const balance = stats?.revision === head.revision ? stats?.balances?.[memberId] : undefined
      return { ...head, balance: Number.isSafeInteger(balance) ? balance : undefined, name: head.summary?.name ?? head.legacyName ?? String(reference.data().name ?? `Group ${head.id.slice(-8)}`) }
    } catch (error) {
      if (codeOf(error) === 'permission-denied') return null
      throw error
    }
  }))
  return groups.filter(group => group !== null).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listPlatformGroups(): Promise<GroupHead[]> {
  const { db, store } = await firebase()
  const results = await store.getDocsFromServer(store.collection(db, 'cloudGroups'))
  return Promise.all(results.docs.map(async doc => {
    const head = consistentHead(doc.id, doc.data())
    if (head.summary || head.archivedAt || head.legacyName) return head
    const ref = await store.getDocFromServer(store.doc(db, 'accounts', head.owner, 'groups', head.id))
    return { ...head, legacyName: ref.data()?.name }
  }))
}

export async function readGroupHead(id: string) {
  if (!isCloudGroup(id)) throw new Error('Check the group link and try again.')
  const { db, store } = await firebase()
  const result = await store.getDocFromServer(store.doc(db, 'cloudGroups', id))
  if (!result.exists()) throw new Error('This group could not be found. Check the link or ask the organiser.')
  return consistentHead(id, result.data())
}

export async function readCloudGroup(id: string): Promise<CloudGroup> {
  const { auth, db, store } = await firebase()
  const uid = auth.currentUser?.uid
  const group = store.doc(db, 'cloudGroups', id)
  for (let attempt = 0; attempt < 2; attempt++) {
    const head = await readGroupHead(id)
    const parts = await Promise.all(Array.from({ length: head.partCount }, (_, index) =>
      store.getDocFromServer(store.doc(group, 'parts', String(index))).then(part => part.data()).catch(error => {
        if (codeOf(error) !== 'permission-denied') throw error
        return undefined
      })))
    if (parts.some((part, index) => part?.part !== index || part.revision !== head.revision || typeof part.payload !== 'string')) {
      if (attempt > 0) throw new Error('Could not load this group. Check your access or try again.')
      continue
    }
    const payload = parts.map(part => part!.payload).join('')
    const entry = parseDirectory({ version: 2, groups: [JSON.parse(payload)] }).groups[0]
    if (entry.id !== id || !('format' in entry)) throw new Error('The stored group did not match this invite.')
    let memberId = head.owner === uid ? head.summary?.ownerMemberId ?? '' : ''
    if (uid && head.owner !== uid && !head.archivedAt) {
      const link = await store.getDocFromServer(store.doc(group, 'members', uid))
      memberId = link.data()?.memberId ?? ''
    }
    const latest = await readGroupHead(id)
    if (latest.revision === head.revision && latest.archivedAt === head.archivedAt) return { ...head, entry, memberId }
  }
  throw new Error('The group changed while loading. Try again.')
}

export async function watchGroupHead(id: string, change: (head: GroupHead) => void, lost: () => void) {
  const { db, store } = await firebase()
  return store.onSnapshot(store.doc(db, 'cloudGroups', id), { includeMetadataChanges: true }, snap => {
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return
    if (snap.exists()) change(consistentHead(id, snap.data()))
    else lost()
  }, lost)
}

export async function saveCloudGroup(account: Account, data: AppData, entry: GroupEntry, expectedRevision?: string): Promise<CloudGroup> {
  if (!account.verified) throw new Error('Verify your email before saving groups.')
  if (!isCloudGroup(entry.id) || !('format' in entry)) throw new Error('Only account groups can be saved to Firebase.')
  const payload = JSON.stringify(entry)
  const count = Math.ceil(payload.length / partSize)
  if (count > maxParts) throw new Error('This group is too large to save. Remove some photos and try again.')
  const { auth, db, store } = await firebase()
  if (auth.currentUser?.uid !== account.id) throw new Error('Sign in again to save this group.')
  const group = store.doc(db, 'cloudGroups', entry.id)
  const index = store.doc(db, 'accounts', account.id, 'groups', entry.id)
  const revision = crypto.randomUUID()
  const owner = account.id
  const archived = data.groups[0].archived
  const summary = summariseGroup(data)
  const pairs = calculateBalances(data.expenses, data.payments)
  const balances = Object.fromEntries(data.members.map(member => [member.id, memberBalance(pairs, member.id).net]))
  await store.runTransaction(db, async transaction => {
    const previous = await transaction.get(group)
    const original = previous.data()
    const head = original ? consistentHead(entry.id, original) : undefined
    if (head && (head.owner !== owner || head.archivedAt || archived)) throw new Error('Only the owner of an active group can edit it.')
    if (head?.revision !== expectedRevision) throw new StaleDataError('Another edit was saved first. Reopen the group and try again.')
    const archive = archived ? { archivedAt: store.serverTimestamp(), archivedBy: owner } : {}
    transaction.set(group, {
      owner, revision, partCount: count, summary, ...archive, ...(original?.restoredAt ? { restoredAt: original.restoredAt } : {}),
      createdAt: original ? original.createdAt ?? null : store.serverTimestamp(),
    })
    if (!archived) transaction.set(index, {})
    transaction.set(store.doc(group, 'stats', 'current'), { revision, balances })
    for (let part = 0; part < count; part++) {
      transaction.set(store.doc(group, 'parts', String(part)), { part, revision, payload: payload.slice(part * partSize, (part + 1) * partSize) })
    }
    for (let part = count; part < (head?.partCount ?? 0); part++) transaction.delete(store.doc(group, 'parts', String(part)))
  }).catch(async error => {
    const saved = await store.getDocFromServer(group).then(result => result.data()).catch(() => undefined)
    if (saved?.revision === revision && saved.owner === owner) return
    if (!expectedRevision && codeOf(error) === 'permission-denied') {
      throw new Error('Firestore blocked group creation. Ask the site administrator to check the deployed Firestore rules.')
    }
    throw error
  })
  return { id: entry.id, entry, revision, owner, partCount: count, summary, memberId: summary.ownerMemberId }
}

export async function changeGroupArchive(id: string, archive: boolean, summary?: GroupSummary) {
  const { auth, db, store } = await firebase()
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Log in again to manage this group.')
  const group = store.doc(db, 'cloudGroups', id)
  await store.runTransaction(db, async transaction => {
    const result = await transaction.get(group)
    if (!result.exists()) throw new Error('This group could not be found.')
    const head = consistentHead(id, result.data())
    if (Boolean(head.archivedAt) === archive) return
    const index = store.doc(db, 'accounts', head.owner, 'groups', id)
    if (archive) {
      const oldName = !summary && !head.summary && !head.legacyName ? (await transaction.get(index)).data()?.name : undefined
      transaction.update(group, { ...(summary && !head.summary ? { summary } : {}), ...(oldName ? { legacyName: oldName } : {}),
        archivedAt: store.serverTimestamp(), archivedBy: uid })
      transaction.delete(index)
    } else {
      transaction.update(group, { archivedAt: store.deleteField(), archivedBy: store.deleteField(), restoredAt: store.serverTimestamp() })
      transaction.set(index, {})
    }
  })
}

export async function createGroupInvitation(id: string, memberId: string) {
  const { db, store } = await firebase()
  const group = store.doc(db, 'cloudGroups', id)
  const assignment = await store.getDocFromServer(store.doc(group, 'assignments', memberId))
  if (assignment.exists()) throw new Error('This member already has a linked account.')
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  await store.setDoc(store.doc(group, 'invites', token), { memberId })
  return token
}

export async function joinCloudGroup(id: string, token: string) {
  if (!isCloudGroup(id) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Ask the organiser for a new member invitation.')
  const { auth, db, store } = await firebase()
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Log in to join this group.')
  const group = store.doc(db, 'cloudGroups', id)
  await store.runTransaction(db, async transaction => {
    const invite = store.doc(group, 'invites', token)
    const result = await transaction.get(invite)
    const record = result.data()
    if (!record) throw new Error('This invitation is unavailable. Ask the organiser for a new one.')
    if (record.claimedBy === uid) return
    transaction.update(invite, { claimedBy: uid })
    transaction.set(store.doc(group, 'members', uid), { memberId: record.memberId, token })
    transaction.set(store.doc(group, 'assignments', record.memberId), { uid })
    transaction.set(store.doc(db, 'accounts', uid, 'joined', id), {})
  })
}
