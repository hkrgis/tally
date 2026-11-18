import { describe, expect, it } from 'vitest'
import published from '../public/app.json'
import { nextSessionDate, parseData, type AppData } from './model'

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
    expect(() => parseData(published)).not.toThrow()
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
  it('rejects duplicate recurring dates', () => {
    const copy = structuredClone(sample)
    const booking = copy.expenses.find(expense => expense.sessionId)!
    copy.expenses.push({ ...booking, id: 'duplicate-booking' })
    expect(() => parseData(copy)).toThrow('only be recorded once')
  })
  it('advances weekly sessions, and keeps the monthly anchor after short months', () => {
    const data = parseData(sample)
    const session = data.sessions[0]
    const booking = data.expenses.find(expense => expense.sessionId === session.id)!
    expect(nextSessionDate(session, data.expenses)).toBe('2026-11-18')
    const monthly = { ...session, startDate: '2026-01-31', frequency: 'Monthly' as const }
    expect(nextSessionDate(monthly, [{ ...booking, date: '2026-01-31' }])).toBe('2026-02-28')
    expect(nextSessionDate(monthly, [{ ...booking, date: '2026-02-28' }])).toBe('2026-03-31')
  })
})
