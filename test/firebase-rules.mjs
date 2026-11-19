import assert from 'node:assert/strict'
import { deleteApp, initializeApp } from 'firebase/app'
import {
  applyActionCode, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, reload, sendEmailVerification,
} from 'firebase/auth'
import {
  collection, connectFirestoreEmulator, deleteField, doc, getDoc, getDocs, getFirestore,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore/lite'

const projectId = 'demo-tally'
const authOrigin = 'http://127.0.0.1:9099'
const storeOrigin = 'http://127.0.0.1:8080'
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

async function register(auth, verified = true) {
  const email = `tally-${crypto.randomUUID()}@example.test`
  const { user } = await createUserWithEmailAndPassword(auth, email, 'firebase-emulator-test')
  if (!verified) return user
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
  return user
}

function denied(promise) {
  return assert.rejects(promise, error => error.code === 'permission-denied')
}

async function seed(path, fields) {
  const response = await fetch(`${storeOrigin}/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ fields }),
  })
  assert.equal(response.ok, true, await response.text())
}

try {
  const owner = client()
  const member = client()
  const outsider = client()
  const admin = client()
  const guest = client()
  const unverified = client()
  const ownerUser = await register(owner.auth)
  const memberUser = await register(member.auth)
  const outsiderUser = await register(outsider.auth)
  const adminUser = await register(admin.auth)
  await register(unverified.auth, false)
  await seed('platformAdmin/identity', {
    firebaseUid: { stringValue: adminUser.uid }, githubOwnerId: { integerValue: '12345' },
  })
  await seed(`accountAdmins/${outsiderUser.uid}`, { enabled: { booleanValue: true } })

  const id = `f-${crypto.randomUUID()}`
  const group = db => doc(db, 'cloudGroups', id)
  const part = (db, number = 0) => doc(group(db), 'parts', String(number))
  const stats = db => doc(group(db), 'stats', 'current')
  const joined = db => doc(db, 'accounts', memberUser.uid, 'joined', id)
  const ownerIndex = db => doc(db, 'accounts', ownerUser.uid, 'groups', id)
  const mapping = db => doc(db, 'platformAdmin', 'identity')
  const summary = { name: 'Group A', currency: 'AUD', memberCount: 2, lastActivityAt: '', ownerMemberId: 'owner' }
  const first = { owner: ownerUser.uid, revision: crypto.randomUUID(), partCount: 2, summary, createdAt: serverTimestamp() }
  const balances = { owner: 300, guest: -300 }
  const storedPart = { part: 0, revision: first.revision, payload: 'encrypted-test-payload' }
  await denied(setDoc(group(unverified.db), first))
  assert.equal((await getDoc(group(owner.db))).exists(), false)
  const batch = writeBatch(owner.db)
  batch.set(group(owner.db), first)
  batch.set(ownerIndex(owner.db), {})
  batch.set(stats(owner.db), { revision: first.revision, balances })
  batch.set(part(owner.db), storedPart)
  batch.set(part(owner.db, 1), { ...storedPart, part: 1 })
  await batch.commit()

  assert.equal((await getDocs(collection(owner.db, 'accounts', ownerUser.uid, 'groups'))).size, 1)
  await denied(getDocs(collection(outsider.db, 'accounts', ownerUser.uid, 'groups')))
  await denied(getDocs(collection(outsider.db, 'cloudGroups')))
  await denied(setDoc(mapping(owner.db), { firebaseUid: ownerUser.uid }))
  await denied(getDoc(mapping(outsider.db)))
  assert.equal((await getDoc(mapping(admin.db))).exists(), true)
  assert.equal((await getDocs(collection(admin.db, 'cloudGroups'))).size, 1)

  for (const client of [guest, unverified, outsider, member]) {
    await denied(getDoc(group(client.db)))
    await denied(getDoc(part(client.db)))
    await denied(getDoc(stats(client.db)))
  }
  await denied(getDoc(part(admin.db)))
  await denied(getDoc(stats(admin.db)))
  await denied(updateDoc(group(outsider.db), { revision: crypto.randomUUID() }))
  await denied(updateDoc(group(admin.db), { owner: adminUser.uid }))
  await denied(setDoc(part(owner.db), { ...storedPart, payload: 'replace-without-edit' }))

  const token = crypto.randomUUID().replaceAll('-', '').repeat(2)
  const invitation = db => doc(group(db), 'invites', token)
  const membership = db => doc(group(db), 'members', memberUser.uid)
  const assignment = db => doc(group(db), 'assignments', 'guest')
  await denied(setDoc(invitation(outsider.db), { memberId: 'guest' }))
  await setDoc(invitation(owner.db), { memberId: 'guest' })
  await denied(getDoc(invitation(guest.db)))
  await denied(getDocs(collection(group(outsider.db), 'invites')))
  await denied(setDoc(membership(member.db), { memberId: 'guest', token }))
  const claim = writeBatch(member.db)
  claim.update(invitation(member.db), { claimedBy: memberUser.uid })
  claim.set(membership(member.db), { memberId: 'guest', token })
  claim.set(assignment(member.db), { uid: memberUser.uid })
  claim.set(joined(member.db), {})
  await claim.commit()
  await denied(getDoc(invitation(outsider.db)))
  await denied(setDoc(doc(group(owner.db), 'invites', 'a'.repeat(64)), { memberId: 'guest' }))
  assert.deepEqual((await getDoc(part(member.db))).data(), storedPart)
  assert.deepEqual((await getDoc(stats(member.db))).data().balances, balances)
  await denied(updateDoc(group(member.db), { revision: crypto.randomUUID() }))
  await denied(setDoc(part(member.db), { ...storedPart, payload: 'member-update' }))

  const edit = writeBatch(owner.db)
  const revision = crypto.randomUUID()
  const nextPart = { ...storedPart, revision }
  edit.update(group(owner.db), { revision, partCount: 1 })
  edit.set(part(owner.db), nextPart)
  edit.set(stats(owner.db), { revision, balances })
  edit.delete(part(owner.db, 1))
  await edit.commit()
  assert.deepEqual((await getDoc(part(member.db))).data(), nextPart)
  await denied(getDoc(part(member.db, 1)))

  await denied(updateDoc(group(owner.db), { archivedAt: serverTimestamp(), archivedBy: ownerUser.uid }))
  const badArchive = writeBatch(owner.db)
  badArchive.update(group(owner.db), { archivedAt: serverTimestamp(), archivedBy: adminUser.uid })
  badArchive.delete(ownerIndex(owner.db))
  await denied(badArchive.commit())
  const memberArchive = writeBatch(member.db)
  memberArchive.update(group(member.db), { archivedAt: serverTimestamp(), archivedBy: memberUser.uid })
  await denied(memberArchive.commit())
  const archive = writeBatch(owner.db)
  archive.update(group(owner.db), { archivedAt: serverTimestamp(), archivedBy: ownerUser.uid })
  archive.delete(ownerIndex(owner.db))
  await archive.commit()

  assert.equal((await getDocs(collection(owner.db, 'accounts', ownerUser.uid, 'groups'))).size, 0)
  const archivedJoined = await getDocs(collection(member.db, 'accounts', memberUser.uid, 'joined'))
  assert.deepEqual(archivedJoined.docs[0].data(), {})
  for (const client of [owner, member, outsider, guest, unverified]) {
    await denied(getDoc(group(client.db)))
    await denied(getDoc(part(client.db)))
  }
  await denied(getDoc(membership(member.db)))
  await denied(getDoc(invitation(member.db)))
  await denied(updateDoc(group(owner.db), { archivedAt: deleteField(), archivedBy: deleteField(), restoredAt: serverTimestamp() }))
  assert.equal((await getDoc(group(admin.db))).data().archivedBy, ownerUser.uid)
  assert.deepEqual((await getDoc(part(admin.db))).data(), nextPart)
  assert.deepEqual((await getDoc(stats(admin.db))).data().balances, balances)
  const restore = writeBatch(admin.db)
  restore.update(group(admin.db), { archivedAt: deleteField(), archivedBy: deleteField(), restoredAt: serverTimestamp() })
  restore.set(ownerIndex(admin.db), {})
  await restore.commit()
  assert.equal((await getDoc(group(owner.db))).data().archivedAt, undefined)
  assert.deepEqual((await getDoc(part(member.db))).data(), nextPart)
  await denied(getDoc(part(outsider.db)))
  await denied(getDoc(part(admin.db)))
  const adminArchive = writeBatch(admin.db)
  adminArchive.update(group(admin.db), { archivedAt: serverTimestamp(), archivedBy: adminUser.uid })
  adminArchive.delete(ownerIndex(admin.db))
  await adminArchive.commit()
  const deletion = writeBatch(admin.db)
  deletion.delete(group(admin.db))
  await denied(deletion.commit())
  assert.deepEqual((await getDoc(part(admin.db))).data(), nextPart)
  const legacyId = `f-${crypto.randomUUID()}`
  const legacyRevision = crypto.randomUUID()
  const legacyPath = `cloudGroups/${legacyId}`
  const legacyIndex = `accounts/${ownerUser.uid}/groups/${legacyId}`
  await seed(legacyPath, {
    owner: { stringValue: ownerUser.uid }, revision: { stringValue: legacyRevision }, partCount: { integerValue: '1' },
  })
  await seed(legacyIndex, { name: { stringValue: 'Earlier group' } })
  await seed(`${legacyPath}/parts/0`, {
    part: { integerValue: '0' }, revision: { stringValue: legacyRevision }, payload: { stringValue: 'old-encrypted-snapshot' },
  })
  assert.equal((await getDoc(doc(owner.db, legacyPath, 'parts', '0'))).data().payload, 'old-encrypted-snapshot')
  await denied(getDoc(doc(outsider.db, legacyPath, 'parts', '0')))
  const legacyArchive = writeBatch(admin.db)
  legacyArchive.update(doc(admin.db, legacyPath), { archivedAt: serverTimestamp(), archivedBy: adminUser.uid, legacyName: 'Earlier group' })
  legacyArchive.delete(doc(admin.db, legacyIndex))
  await legacyArchive.commit()
  await denied(getDoc(doc(owner.db, legacyPath)))
  assert.equal((await getDoc(doc(admin.db, legacyPath))).data().legacyName, 'Earlier group')
  assert.equal((await getDoc(doc(admin.db, legacyPath, 'parts', '0'))).data().payload, 'old-encrypted-snapshot')

  const importedId = `f-${crypto.randomUUID()}`
  const imported = db => doc(db, 'cloudGroups', importedId)
  const importedRevision = crypto.randomUUID()
  const importBatch = writeBatch(owner.db)
  importBatch.set(imported(owner.db), {
    ...first, revision: importedRevision, partCount: 12, archivedAt: serverTimestamp(), archivedBy: ownerUser.uid,
  })
  importBatch.set(doc(imported(owner.db), 'stats', 'current'), { revision: importedRevision, balances })
  for (let part = 0; part < 12; part++) importBatch.set(doc(imported(owner.db), 'parts', String(part)), {
    part, revision: importedRevision, payload: 'encrypted-import',
  })
  await importBatch.commit()
  await denied(getDoc(imported(owner.db)))
  assert.equal((await getDoc(doc(imported(admin.db), 'parts', '11'))).data().payload, 'encrypted-import')
  console.log('Firestore checks passed for authentication, invitations, ownership, admin mapping, archival, restoration and protected snapshots.')
} finally {
  await Promise.all(applications.map(deleteApp))
}
