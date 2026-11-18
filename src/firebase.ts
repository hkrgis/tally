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
const partSize = 500_000
const maxParts = 12
const cloudIdPattern = /^f-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export type Account = { id: string; email: string; verified: boolean }
export type CloudGroup = { entry: GroupEntry; revision: string; owner: string }
export type AccountGroup = { id: string; name: string }

export const cloudGroupId = () => `f-${crypto.randomUUID()}`
export const isCloudGroup = (id: string) => cloudIdPattern.test(id)

async function initialise() {
  if (!firebaseConfigured) throw new Error('Accounts are not set up for this deployment.')
  const [appApi, authApi, store] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore/lite')])
  const previous = appApi.getApps().find(app => app.name === 'tally')
  const app = previous ?? appApi.initializeApp(emulator ? {
    apiKey: 'fake-api-key', authDomain: 'demo-tally.firebaseapp.com', projectId: 'demo-tally', appId: '1:123456789:web:audit',
  } : config, 'tally')
  const auth = previous ? authApi.getAuth(app) : authApi.initializeAuth(app, { persistence: authApi.browserSessionPersistence })
  const db = store.getFirestore(app)
  if (emulator && !previous) {
    authApi.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    store.connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
  return { auth, authApi, db, store }
}

let services: ReturnType<typeof initialise> | undefined
function firebase() {
  return services ??= initialise()
}

export async function observeAccount(onChange: (account: Account | null) => void) {
  const { auth, authApi } = await firebase()
  return authApi.onIdTokenChanged(auth, user => onChange(user ? {
    id: user.uid, email: user.email ?? '', verified: user.emailVerified,
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
    case 'auth/email-already-in-use': return 'Use Sign in or Forgot password to continue with this email.'
    case 'auth/invalid-email': return 'Enter a valid email address.'
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/user-not-found':
    case 'auth/wrong-password': return 'Check the email and password and try again.'
    case 'auth/weak-password': return 'Choose a stronger password.'
    case 'auth/operation-not-allowed': return 'Enable Email/Password in Firebase Authentication.'
    case 'auth/unauthorized-continue-uri': return 'Add this site’s domain to Firebase Authentication’s authorised domains.'
    case 'auth/too-many-requests': return 'Too many attempts. Try again later.'
    case 'auth/network-request-failed': return 'Could not reach Firebase. Check your connection and try again.'
    case 'permission-denied': return 'Firebase denied access. Check your permissions and the deployed Firestore rules.'
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

export async function listAccountGroups(accountId: string): Promise<AccountGroup[]> {
  const { db, store } = await firebase()
  const result = await store.getDocs(store.collection(db, 'accounts', accountId, 'groups'))
  return result.docs.map(doc => ({ id: doc.id, name: String(doc.data().name) })).sort((a, b) => a.name.localeCompare(b.name))
}

function consistentHead(value: Record<string, unknown>) {
  const { owner, revision, partCount } = value
  if (typeof owner !== 'string' || typeof revision !== 'string' || typeof partCount !== 'number' ||
      !Number.isInteger(partCount) || partCount < 1 || partCount > maxParts) throw new Error('The stored group is incomplete.')
  return { owner, revision, partCount }
}

export async function readCloudGroup(id: string): Promise<CloudGroup> {
  if (!isCloudGroup(id)) throw new Error('Check the invite link and try again.')
  const { db, store } = await firebase()
  const group = store.doc(db, 'cloudGroups', id)
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await store.getDoc(group)
    if (!result.exists()) throw new Error('This invite could not be found. Check the link or ask the organiser.')
    const head = consistentHead(result.data())
    const parts = await Promise.all(Array.from({ length: head.partCount }, (_, index) =>
      store.getDoc(store.doc(group, 'parts', String(index))).then(part => part.data()).catch(error => {
        if (codeOf(error) !== 'permission-denied') throw error
        return undefined
      })))
    if (parts.some(part => part?.revision !== head.revision || typeof part?.payload !== 'string')) continue
    const payload = parts.map(part => part!.payload).join('')
    const entry = parseDirectory({ version: 2, groups: [JSON.parse(payload)] }).groups[0]
    if (entry.id !== id || !('format' in entry)) throw new Error('The stored group did not match this invite.')
    return { entry, revision: head.revision, owner: head.owner }
  }
  throw new Error('Could not load a complete group. Refresh the invite and try again.')
}

export async function saveCloudGroup(account: Account, name: string, entry: GroupEntry, expectedRevision?: string): Promise<CloudGroup> {
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
  await store.runTransaction(db, async transaction => {
    const previous = await transaction.get(group)
    const head = previous.exists() ? consistentHead(previous.data()) : undefined
    if (head && head.owner !== owner) throw new Error('Only the group owner can edit it.')
    if (head?.revision !== expectedRevision) throw new StaleDataError('Another edit was saved first. Reopen the group and try again.')
    transaction.set(group, { owner, revision, partCount: count })
    transaction.set(index, { name })
    for (let part = 0; part < count; part++) {
      transaction.set(store.doc(group, 'parts', String(part)), { part, revision, payload: payload.slice(part * partSize, (part + 1) * partSize) })
    }
    for (let part = count; part < (head?.partCount ?? 0); part++) transaction.delete(store.doc(group, 'parts', String(part)))
  }).catch(async error => {
    const saved = await store.getDoc(group).then(result => result.data()).catch(() => undefined)
    if (saved?.revision !== revision || saved.owner !== owner) throw error
  })
  return { entry, revision, owner }
}
