import { describe, expect, it } from 'vitest'
import { decodeGuest, emailKey, guestParts, newToken, snapshotParts } from './guestData'
import { guestToken } from './Guests'
import type { AppData } from './model'

const id = 'f-3ce7a9ff-ffcb-407e-8126-a4019426112c'
const data: AppData = {
  version: 1, groups: [{ id, name: 'Private test group', currency: 'AUD', description: '', archived: false, ownerMemberId: 'owner' }],
  members: [{ id: 'owner', groupId: id, name: 'Owner', active: true }],
  expenses: [], payments: [], sessions: [], activity: [],
}

describe('guest shares', () => {
  it('parses the share link and code without treating member links as guest access', () => {
    const token = newToken()
    expect(guestToken('TALLY-' + token.toUpperCase())).toBe(token)
    expect(guestToken('https://example.com/tally/#guest=' + token)).toBe(token)
    expect(guestToken('https://example.com/tally/?group=' + id + '#invite=' + token)).toBe('')
    expect(guestToken('https://example.com/tally/?guest=' + token)).toBe('')
  })

  it('encrypts the view independently and binds it to its secret and source revision', async () => {
    const token = newToken()
    const parts = await guestParts(data, token, 'revision')
    expect(parts.join('')).not.toContain('Private test group')
    const view = await decodeGuest(parts, token, 'revision') as AppData
    expect(view.groups[0].name).toBe(data.groups[0].name)
    expect(view.groups[0]).not.toHaveProperty('ownerMemberId')
    await expect(decodeGuest(parts, newToken(), 'revision')).rejects.toThrow()
    await expect(decodeGuest(parts, token, 'another revision')).rejects.toThrow()
  })

  it('preserves Unicode across the Firestore part boundary', () => {
    const value = { name: 'a'.repeat(499_990) + '\u{1f3b1}\u{1f3b1}\ufeffZ' }
    const parts = snapshotParts(value)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(part => new TextEncoder().encode(part).length <= 500_000)).toBe(true)
    expect(JSON.parse(parts.join(''))).toEqual(value)
  })

  it('uses the same recipient key regardless of email casing', async () => {
    expect(await emailKey(' Alex@Example.com ')).toBe(await emailKey('alex@example.com'))
  })
})
