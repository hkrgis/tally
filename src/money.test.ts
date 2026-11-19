import { describe, expect, it } from 'vitest'
import { assertSettlement, balanceLabel, calculateBalances, decimal, expenseCharges, memberBalance, memberExpenseTotals, minorDigits, money, parseUnits, settlementPairs, splitExpense } from './money'
import type { Expense, Payment } from './model'

const groupId = 'group'
const entry = (memberId: string, amount: number) => ({ memberId, amount })
const expense = (overrides: Partial<Expense> = {}): Expense => ({
  groupId, id: 'expense-a', date: '2026-11-15', description: 'Dinner', amount: 100,
  category: 'Food & drink', notes: '', payers: [entry('a', 100)],
  split: { method: 'equal', participants: [entry('c', 1), entry('b', 1), entry('a', 1)] },
  ...overrides,
})
const payment = (overrides: Partial<Payment> = {}): Payment => ({
  groupId, id: 'payment-a', from: 'b', to: 'a', amount: 20, date: '2026-11-17', notes: '', ...overrides,
})

describe('integer splits', () => {
  it('allocates equal-split rounding by stable ID, independent of input order', () => {
    const record = expense()
    expect(splitExpense(record)).toEqual([entry('c', 33), entry('b', 33), entry('a', 34)])
    record.split.participants.reverse()
    expect(splitExpense(record)).toEqual([entry('a', 34), entry('b', 33), entry('c', 33)])
  })
  it('allocates percentage remainders and honours explicit zero shares', () => {
    const record = expense({ amount: 3, split: { method: 'percentage', participants: [entry('a', 2500), entry('b', 7500), entry('c', 0)] } })
    expect(splitExpense(record)).toEqual([entry('a', 1), entry('b', 2), entry('c', 0)])
  })
  it('returns exact amounts', () => {
    const shares = [entry('a', 55), entry('b', 45), entry('c', 0)]
    expect(splitExpense(expense({ split: { method: 'exact', participants: shares } }))).toEqual(shares)
  })
  it('splits weighted shares using integer products beyond safe Number precision', () => {
    const record = expense({
      amount: 999_999_999_999, split: { method: 'weighted', participants: [entry('a', 500_000_000_000), entry('b', 1_000_000_000_000)] },
    })
    expect(splitExpense(record)).toEqual([entry('a', 333_333_333_333), entry('b', 666_666_666_666)])
  })
  it('parses decimal currency amounts and rejects extra precision', () => {
    expect(parseUnits('12.07', minorDigits('AUD'))).toBe(1207)
    expect(parseUnits('500', minorDigits('JPY'))).toBe(500)
    expect(parseUnits('89.001', minorDigits('KWD'))).toBe(89001)
    expect(() => parseUnits('1.001', minorDigits('AUD'))).toThrow()
    expect(() => parseUnits('1e5', 2)).toThrow()
  })
  it('formats exact minor units and retains the minus sign below a whole unit', () => {
    expect(decimal(Number.MAX_SAFE_INTEGER, 'AUD')).toBe('90071992547409.91')
    expect(money(Number.MAX_SAFE_INTEGER, 'AUD')).toBe('$90,071,992,547,409.91')
    expect(money(-1, 'AUD')).toBe('-$0.01')
  })
})

describe('original debtor and creditor relationships', () => {
  it('matches multi-payer debts only among the payers and participants on that expense', () => {
    const record = expense({
      amount: 110, payers: [entry('b', 70), entry('a', 40)],
      split: { method: 'exact', participants: [entry('d', 45), entry('c', 45), entry('b', 20)] },
    })
    expect(expenseCharges(record)).toEqual([
      { from: 'c', to: 'a', amount: 40, expenseId: record.id },
      { from: 'c', to: 'b', amount: 5, expenseId: record.id },
      { from: 'd', to: 'b', amount: 45, expenseId: record.id },
    ])
  })
  it('preserves chains and opposite directions across expenses', () => {
    const spends = [['b', 'a'], ['c', 'b'], ['a', 'b']].map(([from, to], index) =>
      expense({ id: `expense-${index}`, payers: [entry(to, 100)], split: { method: 'equal', participants: [entry(from, 1)] } }))
    const pairs = calculateBalances(spends, [payment({ from: 'b', to: 'a', amount: 30 })])
    expect(pairs.map(pair => [pair.from, pair.to, pair.outstanding])).toEqual([
      ['a', 'b', 100], ['c', 'b', 100], ['b', 'a', 70],
    ])
    expect(memberBalance(pairs, 'b')).toEqual({ owes: 70, owed: 200, net: 130 })
  })
  it('applies a partial payment to the oldest charges and keeps each expense visible', () => {
    const newer = expense({ id: 'expense-b', date: '2026-11-16' })
    const pairs = calculateBalances([newer, expense()], [payment({ amount: 40 })])
    const pair = pairs.find(pair => pair.from === 'b')!
    expect(pair).toMatchObject({ charged: 66, paid: 40, outstanding: 26, unapplied: 0 })
    expect(pair.charges.map(charge => [charge.expenseId, charge.outstanding])).toEqual([['expense-a', 0], ['expense-b', 26]])
    expect(pairs.find(pair => pair.from === 'c')?.outstanding).toBe(66)
  })
  it('retains a fully paid pair and shows unapplied money after a correction', () => {
    expect(calculateBalances([expense()], [payment({ amount: 33 })]).find(pair => pair.from === 'b'))
      .toMatchObject({ outstanding: 0, paid: 33, unapplied: 0 })
    const [unmatched] = calculateBalances([], [payment()])
    expect(unmatched).toMatchObject({ from: 'b', to: 'a', outstanding: 0, paid: 20, unapplied: 20 })
    expect(unmatched.payments[0]).toMatchObject({ applied: 0, unapplied: 20 })
  })
})


describe('settlement from group home', () => {
  it('keeps actual directions even when net is zero, with no inferred settlement across a chain', () => {
    const spends = [['b', 'a'], ['c', 'b']].map(([from, to], index) =>
      expense({ id: 'chain-' + index, payers: [entry(to, 100)], split: { method: 'equal', participants: [entry(from, 1)] } }))
    const pairs = calculateBalances(spends, [])
    expect(memberBalance(pairs, 'b').net).toBe(0)
    expect(balanceLabel(0, 'AUD')).toBe('Settled')
    expect(settlementPairs(pairs, 'b').map(pair => [pair.from, pair.to])).toEqual([['b', 'a'], ['c', 'b']])
    expect(() => assertSettlement(payment({ from: 'c', to: 'a' }), spends, [], 'AUD')).toThrow('No outstanding debt')
  })

  it('accepts a partial payment, rejects overpayment and leaves original paid and share totals intact', () => {
    const spends = [expense()]
    const partial = payment({ amount: 20 })
    expect(() => assertSettlement(partial, spends, [], 'AUD')).not.toThrow()
    expect(() => assertSettlement(payment({ amount: 14 }), spends, [partial], 'AUD')).toThrow('$0.13')
    expect(() => assertSettlement(payment({ amount: 0 }), spends, [], 'AUD')).toThrow()
    expect(() => assertSettlement(payment({ amount: 13 }), spends, [partial], 'AUD')).not.toThrow()
    const pairs = calculateBalances(spends, [partial, payment({ id: 'other-payment', amount: 13 })])
    expect(settlementPairs(pairs, 'b')).toEqual([])
    expect(memberExpenseTotals(spends).get('a')).toEqual({ paid: 100, share: 34 })
    expect(memberExpenseTotals(spends).get('b')).toEqual({ paid: 0, share: 33 })
    expect(balanceLabel(memberBalance(pairs, 'a').net, 'AUD')).toBe('Gets back $0.33')
    expect(balanceLabel(memberBalance(pairs, 'c').net, 'AUD')).toBe('Owes $0.33')
  })
})
