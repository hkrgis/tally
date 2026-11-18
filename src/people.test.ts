import { describe, expect, it } from 'vitest'
import type { Member } from './model'
import { accountMemberId, firstName, memberLabels } from './people'

const member = (id: string, name: string): Member => ({ id, name, groupId: 'group', active: true })

describe('group member names and identity', () => {
  it('recognizes older full names and unique single-name entries', () => {
    expect(accountMemberId([member('a', 'Alex Chen'), member('b', 'Alex Rivera')], ' alex  chen ')).toBe('a')
    expect(accountMemberId([member('a', 'Alex')], 'Alex Chen')).toBe('a')
    expect(accountMemberId([member('a', 'Éva')], 'E\u0301va')).toBe('a')
  })

  it('leaves ambiguous and unrelated members unselected', () => {
    expect(accountMemberId([member('a', 'Alex Rivera')], 'Alex Chen')).toBe('')
    expect(accountMemberId([member('a', 'Alex'), member('b', 'Alex Rivera')], 'Alex Chen')).toBe('')
    expect(accountMemberId([member('a', 'Alex'), member('b', 'Alex Rivera')], 'Alex')).toBe('')
    expect(accountMemberId([member('a', 'Alex Chen'), member('b', 'Alex Chen')], 'Alex Chen')).toBe('')
    expect(accountMemberId([member('a', 'Alex')], '')).toBe('')
  })

  it('distinguishes duplicate first names without displaying surnames', () => {
    expect(firstName('  Jean-Luc Martin ')).toBe('Jean-Luc')
    expect(memberLabels([member('a', 'Alex Chen'), member('b', 'Jordan'), member('c', 'Alex Rivera')]))
      .toEqual(new Map([['a', 'Alex (1)'], ['b', 'Jordan'], ['c', 'Alex (2)']]))
  })
})
