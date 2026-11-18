import { describe, expect, it } from 'vitest'
import published from '../public/app.json'
import { groupPaymentMethods, isProfileEmoji, parseData, registerPaymentMethod, type AppData } from './model'
import { parseDirectory } from './vault'

const sample: AppData = {
  version: 1,
  groups: [
    { id: 'tennis', name: 'Wednesday Tennis', currency: 'AUD', archived: false, description: '' },
    { id: 'house', name: 'House', currency: 'AUD', archived: false, description: '' },
  ],
  members: [
    { id: 'a', groupId: 'tennis', name: 'A', active: true },
    { id: 'b', groupId: 'tennis', name: 'B', active: true },
    { id: 'c', groupId: 'house', name: 'C', active: true },
  ],
  expenses: [{
    id: 'court-hire', groupId: 'tennis', description: 'Court hire', amount: 4800,
    category: 'Sports', date: '2026-11-11', notes: '',
    payers: [{ memberId: 'a', amount: 4800 }],
    split: { method: 'equal', participants: [{ memberId: 'a', amount: 1 }, { memberId: 'b', amount: 1 }] },
    sessionId: 'weekly-court',
  }],
  payments: [{ id: 'payment', groupId: 'tennis', from: 'b', to: 'a', amount: 1200, date: '2026-11-12', notes: '' }],
  sessions: [{
    id: 'weekly-court', groupId: 'tennis', name: 'Court hire', amount: 4800,
    startDate: '2026-11-11', frequency: 'Weekly', payerId: 'a', attendeeIds: ['a', 'b'], active: true,
  }],
  activity: [],
}

describe('published ledger validation', () => {
  it('checks the configured published ledger before deployment', () => {
    expect(() => parseDirectory(published)).not.toThrow()
  })
  it('rejects malformed dates, payments across groups, and mismatched payout totals', () => {
    const badDate = structuredClone(sample)
    badDate.expenses[0].date = '2026-11-31'
    expect(() => parseData(badDate)).toThrow('date')
    const crossGroup = structuredClone(sample)
    crossGroup.payments[0].to = 'c'
    expect(() => parseData(crossGroup)).toThrow('distinct members of the group')
    const payerAmount = structuredClone(sample)
    payerAmount.expenses[0].payers[0].amount -= 1
    expect(() => parseData(payerAmount)).toThrow('payer amounts')
  })
  it('accepts explicit zero exact or percentage shares', () => {
    const copy = structuredClone(sample)
    copy.expenses[0].split = { method: 'exact', participants: [{ memberId: 'a', amount: 0 }, { memberId: 'b', amount: 4800 }] }
    expect(() => parseData(copy)).not.toThrow()
    copy.expenses[0].split.method = 'weighted'
    expect(() => parseData(copy)).toThrow('split values')
  })
  it('retains legacy schedule records and allows editing their expenses as regular transactions', () => {
    const copy = structuredClone(sample)
    copy.expenses.push({ ...copy.expenses[0], id: 'other-court-hire', date: '2026-11-18' })
    const data = parseData(copy)
    data.expenses[0].date = data.expenses[1].date
    expect(parseData(data)).toEqual(data)
  })
  it('reuses default and custom payment methods while accepting older records', () => {
    const data = parseData(sample)
    expect(groupPaymentMethods(data.groups[0])).toEqual(['Cash', 'PayID'])
    data.expenses[0].paymentMethod = registerPaymentMethod(data, 'tennis', 'bank transfer')
    data.payments[0].paymentMethod = registerPaymentMethod(data, 'tennis', ' PAYID ')
    expect(registerPaymentMethod(data, 'tennis', 'Bank Transfer')).toBe('bank transfer')
    expect(parseData(data).payments[0].paymentMethod).toBe('PayID')
  })
  it('recognises a single emoji for profiles', () => {
    expect(isProfileEmoji('🏓')).toBe(true)
    expect(isProfileEmoji('👩🏽‍💻')).toBe(true)
    expect(isProfileEmoji('🇦🇺')).toBe(true)
    expect(isProfileEmoji('🏓🏓')).toBe(false)
    expect(isProfileEmoji('User')).toBe(false)
  })
})
