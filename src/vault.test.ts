import { describe, expect, it } from 'vitest'
import { type AppData } from './model'
import { createGroupKey, inviteCode, openGroup, parseDirectory, sameDirectory, sealGroup } from './vault'

const password = 'sample test phrase only'
const group = { id: 'book-club', name: 'Book Club', description: 'Private group description', currency: 'AUD', archived: false }
const data: AppData = {
  version: 1, groups: [group],
  members: [{ id: 'a', name: 'Private member name', active: true, groupId: group.id }],
  expenses: [{
    id: 'first', groupId: group.id, description: 'Private expense', date: '2026-11-18',
    amount: 1000, category: 'Other', notes: 'Private receipt note', payers: [{ memberId: 'a', amount: 1000 }],
    split: { method: 'equal', participants: [{ memberId: 'a', amount: 1 }] },
    photos: [{ id: 'photo', name: 'receipt.jpg', source: 'data:image/jpeg;base64,/9j/2Q==' }],
  }],
  payments: [], sessions: [], activity: [],
}

describe('encrypted group records', () => {
  it('round-trips every record while publishing only group metadata and ciphertext', async () => {
    const key = await createGroupKey(password)
    const entry = await sealGroup(data, key)
    const directory = parseDirectory({ version: 2, groups: [entry] })
    expect(sameDirectory(directory, { version: 2, groups: [entry] })).toBe(true)
    expect(sameDirectory(directory, { ...directory, revision: 'unrelated-revision' })).toBe(false)
    const published = JSON.stringify(directory)
    expect(key.key.extractable).toBe(false)
    for (const privateValue of ['Book Club', password, 'Private member', 'Private receipt', 'Private expense', 'receipt.jpg', 'data:image']) {
      expect(published).not.toContain(privateValue)
    }
    expect((await openGroup(directory.groups[0], password)).data).toEqual(data)
  })

  it('rejects the wrong password and metadata tampering and uses a fresh IV for each save', async () => {
    const key = await createGroupKey(password)
    const entry = await sealGroup(data, key)
    expect((await sealGroup(data, key)).iv).not.toBe(entry.iv)
    await expect(openGroup(entry, 'a different test password')).rejects.toThrow('Could not unlock')
    await expect(openGroup({ ...entry, id: 'other-id' }, password)).rejects.toThrow('Could not unlock')
    expect(() => parseDirectory({ version: 2, groups: [entry, entry] })).toThrow('duplicate')
    expect(() => parseDirectory({ version: 2, groups: [{ ...entry, data }] })).toThrow()
  })

  it('unlocks older envelopes and saves them without their original public name', async () => {
    const { key, salt } = await createGroupKey(password)
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
    const utf8 = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const { id, name, archived } = group
    const ciphertext = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: utf8.encode(JSON.stringify([2, id, name, archived, salt])),
    }, key, utf8.encode(JSON.stringify(data)))
    const legacy = { id, name, archived, salt, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
    const entry = parseDirectory({ version: 2, groups: [legacy] }).groups[0]
    const opened = await openGroup(entry, password)
    const saved = await sealGroup(opened.data, opened)
    expect(saved).not.toHaveProperty('name')
    expect(saved).not.toHaveProperty('archived')
    expect((await openGroup(saved, password)).data).toEqual(data)
  })

  it('accepts invite links and codes without converting them to external requests', () => {
    expect(inviteCode('book-club')).toBe('book-club')
    expect(inviteCode('https://example.com/tally/?group=book-club#expenses')).toBe('book-club')
    expect(inviteCode('https://example.com/tally/?group=%2Fother')).toBe('')
  })

  it('protects the new version with a new password after rotation', async () => {
    const newPassword = 'changed test password'
    const entry = await sealGroup(data, await createGroupKey(newPassword))
    await expect(openGroup(entry, password)).rejects.toThrow('Could not unlock')
    expect((await openGroup(entry, newPassword)).data).toEqual(data)
    await expect(createGroupKey('123456')).rejects.toThrow('Choose a group password')
  })
})
