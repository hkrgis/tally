import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deleteApp, initializeApp } from 'firebase/app'
import {
  applyActionCode, connectAuthEmulator, createUserWithEmailAndPassword, getAuth, reload, sendEmailVerification,
} from 'firebase/auth'
import {
  collection, connectFirestoreEmulator, deleteDoc, deleteField, doc, getDoc, getDocs, getFirestore, limit, query, Timestamp,
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
  const first = { owner: ownerUser.uid, revision: crypto.randomUUID(), partCount: 2, summary, storage: 'account', createdAt: serverTimestamp() }
  const balances = { owner: 300, guest: -300 }
  const storedPart = { part: 0, revision: first.revision, payload: 'account-protected-test-payload' }
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

  const staleToken = crypto.randomUUID().replaceAll('-', '').repeat(2)
  const token = crypto.randomUUID().replaceAll('-', '').repeat(2)
  const invitation = (db, key = token) => doc(group(db), 'invites', key)
  const inviteLink = db => doc(group(db), 'inviteLinks', 'guest')
  const membership = db => doc(group(db), 'members', memberUser.uid)
  const assignment = db => doc(group(db), 'assignments', 'guest')
  await denied(setDoc(invitation(outsider.db), { memberId: 'guest' }))
  await denied(setDoc(invitation(owner.db), { memberId: 'guest' }))
  await denied(getDoc(inviteLink(member.db)))
  const invite = writeBatch(owner.db)
  invite.set(invitation(owner.db, staleToken), { memberId: 'guest' })
  invite.set(inviteLink(owner.db), { token: staleToken })
  await invite.commit()
  assert.equal((await getDoc(invitation(member.db, staleToken))).data().memberId, 'guest')
  const rotate = writeBatch(owner.db)
  rotate.set(invitation(owner.db), { memberId: 'guest' })
  rotate.set(inviteLink(owner.db), { token })
  await rotate.commit()
  await denied(getDoc(invitation(member.db, staleToken)))
  await denied(updateDoc(invitation(member.db, staleToken), { claimedBy: memberUser.uid }))
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
  edit.update(group(owner.db), { revision, partCount: 1, receiptVersion: 1, summary: { ...summary, description: "Shared matches" } })
  edit.set(part(owner.db), nextPart)
  edit.set(stats(owner.db), { revision, balances })
  edit.delete(part(owner.db, 1))
  await edit.commit()
  assert.deepEqual((await getDoc(part(member.db))).data(), nextPart)
  await denied(getDoc(part(member.db, 1)))
  assert.equal((await getDoc(group(member.db))).data().summary.description, "Shared matches")
  const staleEditor = writeBatch(owner.db)
  const staleRevision = crypto.randomUUID()
  staleEditor.update(group(owner.db), { revision: staleRevision, receiptVersion: deleteField() })
  staleEditor.set(part(owner.db), { ...nextPart, revision: staleRevision })
  staleEditor.set(stats(owner.db), { revision: staleRevision, balances })
  await denied(staleEditor.commit())
  assert.equal((await getDoc(group(owner.db))).data().receiptVersion, 1)
  assert.deepEqual((await getDoc(part(owner.db))).data(), nextPart)

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
  const revokedRevision = crypto.randomUUID()
  const stillPreserved = { ...nextPart, revision: revokedRevision }
  const removeLinkOnly = writeBatch(owner.db)
  removeLinkOnly.delete(membership(owner.db))
  await denied(removeLinkOnly.commit())
  await denied(setDoc(inviteLink(owner.db), { token: '' }))
  const revoke = writeBatch(owner.db)
  revoke.update(group(owner.db), { revision: revokedRevision })
  revoke.set(part(owner.db), stillPreserved)
  revoke.set(stats(owner.db), { revision: revokedRevision, balances })
  revoke.set(inviteLink(owner.db), { token: '' })
  revoke.delete(membership(owner.db))
  revoke.delete(assignment(owner.db))
  revoke.delete(joined(owner.db))
  await revoke.commit()
  assert.deepEqual((await getDoc(part(owner.db))).data(), stillPreserved)
  assert.equal((await getDocs(collection(member.db, 'accounts', memberUser.uid, 'joined'))).size, 0)
  await denied(getDoc(group(member.db)))
  await denied(getDoc(part(member.db)))
  await denied(getDoc(invitation(member.db)))
  await denied(getDoc(invitation(member.db, staleToken)))
  const downgrade = writeBatch(owner.db)
  const downgradedRevision = crypto.randomUUID()
  downgrade.update(group(owner.db), { revision: downgradedRevision, storage: deleteField() })
  downgrade.set(part(owner.db), { ...stillPreserved, revision: downgradedRevision })
  downgrade.set(stats(owner.db), { revision: downgradedRevision, balances })
  await denied(downgrade.commit())
  const adminArchive = writeBatch(admin.db)
  adminArchive.update(group(admin.db), { archivedAt: serverTimestamp(), archivedBy: adminUser.uid })
  adminArchive.delete(ownerIndex(admin.db))
  await adminArchive.commit()
  const deletion = writeBatch(admin.db)
  deletion.delete(group(admin.db))
  await denied(deletion.commit())
  assert.deepEqual((await getDoc(part(admin.db))).data(), stillPreserved)
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

  const upgradedRevision = crypto.randomUUID()
  const legacyUpgrade = writeBatch(admin.db)
  legacyUpgrade.update(doc(admin.db, legacyPath), {
    revision: upgradedRevision, storage: 'account', createdAt: null, summary, legacyName: deleteField(),
  })
  legacyUpgrade.set(doc(admin.db, legacyPath, 'stats', 'current'), { revision: upgradedRevision, balances })
  legacyUpgrade.set(doc(admin.db, legacyPath, 'parts', '0'), {
    part: 0, revision: upgradedRevision, payload: 'converted-archive',
  })
  await denied(legacyUpgrade.commit())
  assert.equal((await getDoc(doc(admin.db, legacyPath))).data().archivedBy, adminUser.uid)
  await denied(getDoc(doc(owner.db, legacyPath, 'parts', '0')))
  assert.equal((await getDoc(doc(admin.db, legacyPath, 'parts', '0'))).data().payload, 'old-encrypted-snapshot')

  const importedId = `f-${crypto.randomUUID()}`
  const imported = db => doc(db, 'cloudGroups', importedId)
  const restoreLegacy = writeBatch(admin.db)
  restoreLegacy.update(doc(admin.db, legacyPath), { archivedAt: deleteField(), archivedBy: deleteField(), restoredAt: serverTimestamp() })
  restoreLegacy.set(doc(admin.db, legacyIndex), {})
  await restoreLegacy.commit()
  await seed(legacyPath + '/members/' + memberUser.uid, { memberId: { stringValue: 'guest' } })
  const keyPath = db => doc(db, legacyPath, 'access', 'account')
  const newKey = { key: 'A'.repeat(43) + '=' }
  const keyedRevision = crypto.randomUUID()
  const activate = (db, includeKey = true) => {
    const batch = writeBatch(db)
    batch.update(doc(db, legacyPath), { revision: keyedRevision, storage: 'key', legacyName: deleteField(), summary, createdAt: null })
    batch.set(doc(db, legacyPath, 'parts', '0'), { part: 0, revision: keyedRevision, payload: 'resealed-ledger-payload' })
    batch.set(doc(db, legacyPath, 'stats', 'current'), { revision: keyedRevision, balances })
    if (includeKey) batch.set(keyPath(db), newKey)
    return batch.commit()
  }
  await denied(setDoc(keyPath(owner.db), newKey))
  await denied(activate(owner.db, false))
  await denied(activate(member.db))
  await denied(activate(admin.db))
  await activate(owner.db)
  assert.deepEqual((await getDoc(keyPath(owner.db))).data(), newKey)
  assert.deepEqual((await getDoc(keyPath(member.db))).data(), newKey)
  for (const account of [outsider, guest, unverified, admin]) await denied(getDoc(keyPath(account.db)))
  await denied(getDocs(collection(owner.db, legacyPath, 'access')))
  await denied(setDoc(keyPath(owner.db), { key: 'B'.repeat(43) + '=' }))
  await denied(deleteDoc(keyPath(owner.db)))
  const dropAccountAccess = writeBatch(owner.db)
  const dropAccountAccessRevision = crypto.randomUUID()
  dropAccountAccess.update(doc(owner.db, legacyPath), { revision: dropAccountAccessRevision, storage: deleteField() })
  dropAccountAccess.set(doc(owner.db, legacyPath, 'stats', 'current'), { revision: dropAccountAccessRevision, balances })
  await denied(dropAccountAccess.commit())
  const archiveKeyed = writeBatch(owner.db)
  archiveKeyed.update(doc(owner.db, legacyPath), { archivedAt: serverTimestamp(), archivedBy: ownerUser.uid })
  archiveKeyed.delete(doc(owner.db, legacyIndex))
  await archiveKeyed.commit()
  for (const account of [owner, member, outsider, guest]) await denied(getDoc(keyPath(account.db)))
  assert.deepEqual((await getDoc(keyPath(admin.db))).data(), newKey)
  const restoreKeyed = writeBatch(admin.db)
  restoreKeyed.update(doc(admin.db, legacyPath), { archivedAt: deleteField(), archivedBy: deleteField(), restoredAt: serverTimestamp() })
  restoreKeyed.set(doc(admin.db, legacyIndex), {})
  await restoreKeyed.commit()
  assert.deepEqual((await getDoc(keyPath(member.db))).data(), newKey)

  const importedRevision = crypto.randomUUID()
  const importBatch = writeBatch(owner.db)
  importBatch.set(imported(owner.db), {
    ...first, revision: importedRevision, partCount: 12, archivedAt: serverTimestamp(), archivedBy: ownerUser.uid,
  })
  importBatch.set(doc(imported(owner.db), 'stats', 'current'), { revision: importedRevision, balances })
  for (let part = 0; part < 12; part++) importBatch.set(doc(imported(owner.db), 'parts', String(part)), {
    part, revision: importedRevision, payload: 'account-protected-import',
  })
  await importBatch.commit()
  await denied(getDoc(imported(owner.db)))
  assert.equal((await getDoc(doc(imported(admin.db), 'parts', '11'))).data().payload, 'account-protected-import')
  const shareId = 'f-' + crypto.randomUUID()
  const shareGroup = db => doc(db, 'cloudGroups', shareId)
  const shareRevision = crypto.randomUUID()
  const support = writeBatch(owner.db)
  support.set(shareGroup(owner.db), { ...first, revision: shareRevision, partCount: 1 })
  support.set(doc(owner.db, 'accounts', ownerUser.uid, 'groups', shareId), {})
  support.set(doc(shareGroup(owner.db), 'stats', 'current'), { revision: shareRevision, balances })
  support.set(doc(shareGroup(owner.db), 'parts', '0'), { part: 0, revision: shareRevision, payload: 'private ledger' })
  await support.commit()

  const guestToken = 'b'.repeat(64)
  const guestLink = (db, token = guestToken) => doc(db, 'guestShares', token)
  const guestConfig = db => doc(db, 'guestConfig', shareId)
  const guestBody = { part: 0, revision: shareRevision, payload: 'encrypted guest projection' }
  const expiry = Timestamp.fromMillis(Date.now() + 86_400_000)
  async function publish(token) {
    const transaction = writeBatch(owner.db)
    transaction.set(guestConfig(owner.db), { token, expiresAt: expiry })
    transaction.set(guestLink(owner.db, token), { id: shareId, partCount: 1, revision: shareRevision, expiresAt: expiry })
    transaction.set(doc(guestLink(owner.db, token), 'parts', '0'), guestBody)
    await transaction.commit()
  }
  await publish(guestToken)
  assert.deepEqual((await getDoc(doc(guestLink(guest.db), 'parts', '0'))).data(), guestBody)
  await denied(getDocs(collection(guest.db, 'guestShares')))
  await denied(getDocs(collection(guestLink(guest.db), 'parts')))
  await denied(getDoc(guestConfig(guest.db)))
  await denied(getDoc(shareGroup(guest.db)))
  await denied(getDoc(doc(shareGroup(guest.db), 'parts', '0')))
  await denied(updateDoc(guestLink(guest.db), { id: id }))
  await denied(setDoc(doc(guestLink(guest.db), 'parts', '0'), guestBody))
  await denied(deleteDoc(guestConfig(outsider.db)))
  await denied(getDoc(guestLink(guest.db, '9'.repeat(64))))
  const rotated = 'd'.repeat(64)
  await publish(rotated)
  await denied(getDoc(guestLink(guest.db)))
  await denied(getDoc(doc(guestLink(guest.db), 'parts', '0')))
  assert.equal((await getDoc(guestLink(guest.db, rotated))).data().id, shareId)
  await deleteDoc(guestConfig(owner.db))
  await denied(getDoc(guestLink(guest.db, rotated)))
  await publish(rotated)
  const expired = new Date(Date.now() - 1000).toISOString()
  await seed('guestConfig/' + shareId, { token: { stringValue: rotated }, expiresAt: { timestampValue: expired } })
  await seed('guestShares/' + rotated, {
    id: { stringValue: shareId }, revision: { stringValue: shareRevision }, partCount: { integerValue: '1' }, expiresAt: { timestampValue: expired },
  })
  await denied(getDoc(guestLink(guest.db, rotated)))
  await publish(rotated)

  const digest = createHash('sha256').update(memberUser.email.toLowerCase()).digest('hex')
  const profile = { uid: memberUser.uid, name: 'Riley Example', searchName: 'riley example', email: memberUser.email, photo: '' }
  const directory = db => doc(db, 'discovery', digest)
  const nameIndex = db => collection(db, 'discoveryNames', 'ril', 'profiles')
  await denied(setDoc(directory(outsider.db), profile))
  await setDoc(directory(member.db), profile)
  await setDoc(doc(nameIndex(member.db), digest), profile)
  await denied(getDoc(directory(guest.db)))
  await denied(getDocs(collection(owner.db, 'discovery')))
  await denied(getDocs(nameIndex(owner.db)))
  assert.equal((await getDocs(query(nameIndex(owner.db), limit(8)))).size, 1)
  assert.equal((await getDoc(directory(owner.db))).data().name, profile.name)
  await deleteDoc(directory(member.db))
  await deleteDoc(doc(nameIndex(member.db), digest))
  assert.equal((await getDoc(directory(owner.db))).exists(), false)

  const target = db => doc(shareGroup(db), 'targetInvites', digest)
  const inbox = db => doc(db, 'memberInboxes', digest, 'invitations', shareId)
  const targetedLink = db => doc(shareGroup(db), 'inviteLinks', 'invitee')
  const privateToken = 'e'.repeat(64)
  const ticket = (db, token = privateToken) => doc(shareGroup(db), 'invites', token)
  const subject = { email: memberUser.email, groupName: 'Group A', memberId: 'invitee', expiresAt: expiry, status: 'pending' }
  async function issue(token) {
    const transaction = writeBatch(owner.db)
    transaction.set(target(owner.db), { ...subject, token })
    transaction.set(inbox(owner.db), { token, status: 'pending' })
    transaction.set(ticket(owner.db, token), { memberId: subject.memberId, target: digest })
    transaction.set(targetedLink(owner.db), { token })
    return transaction.commit()
  }
  await issue(privateToken)
  await denied(issue('f'.repeat(64)))
  await denied(getDoc(inbox(outsider.db)))
  await denied(getDoc(ticket(guest.db)))
  await denied(getDoc(ticket(outsider.db)))
  await denied(getDoc(target(outsider.db)))
  assert.equal((await getDoc(inbox(member.db))).data().status, 'pending')
  assert.equal((await getDoc(ticket(member.db))).data().memberId, subject.memberId)
  const revokeTarget = writeBatch(owner.db)
  revokeTarget.update(target(owner.db), { status: 'revoked' })
  revokeTarget.update(inbox(owner.db), { status: 'revoked' })
  await revokeTarget.commit()
  await denied(getDoc(ticket(member.db)))
  const fresh = 'f'.repeat(64)
  await issue(fresh)
  const joinTarget = writeBatch(member.db)
  joinTarget.update(ticket(member.db, fresh), { claimedBy: memberUser.uid })
  joinTarget.set(doc(shareGroup(member.db), 'members', memberUser.uid), { memberId: subject.memberId, token: fresh, emailKey: digest })
  joinTarget.set(doc(shareGroup(member.db), 'linkedEmails', digest), { uid: memberUser.uid })
  joinTarget.set(doc(shareGroup(member.db), 'assignments', subject.memberId), { uid: memberUser.uid })
  joinTarget.set(doc(member.db, 'accounts', memberUser.uid, 'joined', shareId), {})
  joinTarget.update(target(member.db), { status: 'accepted' })
  joinTarget.update(inbox(member.db), { status: 'accepted' })
  await joinTarget.commit()
  assert.equal((await getDoc(inbox(member.db))).data().status, 'accepted')
  assert.equal((await getDoc(doc(shareGroup(member.db), 'parts', '0'))).data().payload, 'private ledger')
  await denied(issue('c'.repeat(64)))
  const archiveShared = writeBatch(owner.db)
  archiveShared.update(shareGroup(owner.db), { archivedAt: serverTimestamp(), archivedBy: ownerUser.uid })
  archiveShared.delete(doc(owner.db, 'accounts', ownerUser.uid, 'groups', shareId))
  archiveShared.delete(guestConfig(owner.db))
  await archiveShared.commit()
  await denied(getDoc(guestLink(guest.db, rotated)))
  await denied(getDoc(target(member.db)))
  console.log('Firestore checks passed for guest capability reads, invitation identity and lifecycle, access revocation, owner and admin permissions.')
} finally {
  await Promise.all(applications.map(deleteApp))
}
