import { describe, expect, it } from 'vitest'
import { type AppData } from './model'
import { createGroupKey, openGroup, parseDirectory, sealGroup } from './vault'

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
    const published = JSON.stringify(directory)
    expect(key.key.extractable).toBe(false)
    expect(published).toContain('Book Club')
    for (const privateValue of [password, 'Private member', 'Private receipt', 'Private expense', 'receipt.jpg', 'data:image']) {
      expect(published).not.toContain(privateValue)
    }
    expect((await openGroup(directory.groups[0], password)).data).toEqual(data)
  })

  it('rejects the wrong password and metadata tampering and uses a fresh IV for each save', async () => {
    const key = await createGroupKey(password)
    const entry = await sealGroup(data, key)
    expect((await sealGroup(data, key)).iv).not.toBe(entry.iv)
    await expect(openGroup(entry, 'a different test password')).rejects.toThrow('Could not unlock')
    await expect(openGroup({ ...entry, name: 'Changed name' }, password)).rejects.toThrow('Could not unlock')
    expect(() => parseDirectory({ version: 2, groups: [entry, entry] })).toThrow('duplicate')
    expect(() => parseDirectory({ version: 2, groups: [{ ...entry, data }] })).toThrow()
  })

  it('protects the new version with a new password after rotation', async () => {
    const newPassword = 'changed test password'
    const entry = await sealGroup(data, await createGroupKey(newPassword))
    await expect(openGroup(entry, password)).rejects.toThrow('Could not unlock')
    expect((await openGroup(entry, newPassword)).data).toEqual(data)
    await expect(createGroupKey('123456')).rejects.toThrow('Choose a group password')
  })
})
