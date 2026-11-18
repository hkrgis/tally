import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase/app'
import {
  applyActionCode, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, reload, sendEmailVerification,
} from 'firebase/auth'
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch,
} from 'firebase/firestore/lite'

const projectId = 'demo-tally'
const authOrigin = 'http://127.0.0.1:9099'
const applications = []

function client() {
  const app = initializeApp({ apiKey: 'emulator-test-key', authDomain: 'demo-tally.firebaseapp.com', projectId }, crypto.randomUUID())
  applications.push(app)
  const auth = getAuth(app)
  const db = getFirestore(app)
  connectAuthEmulator(auth, authOrigin, { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  return { auth, db }
}

async function register(auth) {
  const email = `audit-${crypto.randomUUID()}@example.test`
  return (await createUserWithEmailAndPassword(auth, email, 'firebase-emulator-test')).user
}

async function verify(auth, user) {
  await sendEmailVerification(user)
  const response = await fetch(`${authOrigin}/emulator/v1/projects/${projectId}/oobCodes`)
  assert.equal(response.ok, true)
  const { oobCodes } = await response.json()
  const code = oobCodes.find(item => item.email === user.email && item.requestType === 'VERIFY_EMAIL')
  assert(code)
  await applyActionCode(auth, code.oobCode)
  await reload(user)
  await user.getIdToken(true)
  assert.equal(user.emailVerified, true)
}

function denied(promise) {
  return assert.rejects(promise, error => error.code === 'permission-denied')
}

try {
  const owner = client()
  const outsider = client()
  const guest = client()
  const ownerUser = await register(owner.auth)
  const outsiderUser = await register(outsider.auth)
  const groupId = `f-${crypto.randomUUID()}`
  const ownerGroup = doc(owner.db, 'cloudGroups', groupId)
  const initialHead = { owner: ownerUser.uid, revision: crypto.randomUUID(), partCount: 2 }
  await denied(setDoc(ownerGroup, initialHead))
  await verify(owner.auth, ownerUser)
  await verify(outsider.auth, outsiderUser)

  const batch = writeBatch(owner.db)
  batch.set(ownerGroup, initialHead)
  batch.set(doc(owner.db, 'accounts', ownerUser.uid, 'groups', groupId), { name: 'Private group name' })
  for (let part = 0; part < initialHead.partCount; part++) {
    batch.set(doc(ownerGroup, 'parts', String(part)), { part, revision: initialHead.revision, payload: 'encrypted-test-payload' })
  }
  await batch.commit()

  assert.equal((await getDocs(collection(owner.db, 'accounts', ownerUser.uid, 'groups'))).size, 1)
  await denied(getDocs(collection(outsider.db, 'accounts', ownerUser.uid, 'groups')))
  await denied(getDocs(collection(guest.db, 'cloudGroups')))
  assert.deepEqual((await getDoc(doc(guest.db, 'cloudGroups', groupId))).data(), initialHead)
  assert.equal((await getDoc(doc(guest.db, 'cloudGroups', groupId, 'parts', '0'))).exists(), true)

  await denied(setDoc(doc(outsider.db, 'cloudGroups', groupId), { ...initialHead, owner: outsiderUser.uid, revision: crypto.randomUUID() }))
  await denied(setDoc(doc(outsider.db, 'cloudGroups', groupId, 'parts', '0'), {
    part: 0, revision: initialHead.revision, payload: 'unrelated replacement',
  }))
  await denied(setDoc(doc(owner.db, 'accountAdmins', ownerUser.uid), { enabled: true }))
  const nextHead = { ...initialHead, revision: crypto.randomUUID(), partCount: 1 }
  const edit = writeBatch(owner.db)
  edit.set(ownerGroup, nextHead)
  edit.set(doc(ownerGroup, 'parts', '0'), { part: 0, revision: nextHead.revision, payload: 'updated encrypted payload' })
  edit.delete(doc(ownerGroup, 'parts', '1'))
  await edit.commit()
  assert.equal((await getDoc(doc(guest.db, 'cloudGroups', groupId))).data().revision, nextHead.revision)
  await denied(getDoc(doc(guest.db, 'cloudGroups', groupId, 'parts', '1')))
  console.log('Firestore rules enforce email verification, ownership, private listings, admin role protection and read-only encrypted invites.')
} finally {
  await Promise.all(applications.map(deleteApp))
}
