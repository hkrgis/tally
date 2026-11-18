import type { Expense, Payment } from './model'

export const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function minorDigits(currency: string) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
}

export function parseUnits(value: string, digits: number) {
  const [whole, fraction = ''] = value.trim().split('.')
  if (!/^\d+(?:\.\d+)?$/.test(value.trim()) || fraction.length > digits) {
    throw new Error(`Enter a non-negative number with at most ${digits} decimal places.`)
  }
  const amount = Number(whole + fraction.padEnd(digits, '0'))
  if (!Number.isSafeInteger(amount)) throw new Error('That amount is too large.')
  return amount
}

export function decimal(amount: number, currency: string) {
  const digits = minorDigits(currency)
  if (!digits) return String(amount)
  const scale = 10n ** BigInt(digits)
  const units = BigInt(Math.abs(amount))
  return `${amount < 0 ? '-' : ''}${units / scale}.${String(units % scale).padStart(digits, '0')}`
}

export function money(amount: number, currency: string) {
  const [whole, fraction] = decimal(amount, currency).split('.')
  const format = new Intl.NumberFormat('en-AU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
  const integral = whole === '-0' ? -0 : BigInt(whole)
  return format.formatToParts(integral).map(part => part.type === 'fraction' ? fraction : part.value).join('')
}

export function splitExpense(expense: Expense) {
  const { method, participants } = expense.split
  if (method === 'exact') return participants.map(participant => ({ ...participant }))
  const weights = participants.map(participant => BigInt(method === 'equal' ? 1 : participant.amount))
  const totalWeight = weights.reduce((total, weight) => total + weight, 0n)
  const shares = participants.map(({ memberId }, index) => {
    const product = BigInt(expense.amount) * weights[index]
    return { memberId, amount: Number(product / totalWeight), remainder: product % totalWeight }
  })
  const left = expense.amount - shares.reduce((total, share) => total + share.amount, 0)
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder
    ? compareId(a.memberId, b.memberId)
    : a.remainder > b.remainder ? -1 : 1)
  ranked.slice(0, left).forEach(share => share.amount++)
  return shares.map(({ memberId, amount }) => ({ memberId, amount }))
}

export type Charge = { from: string; to: string; amount: number; expenseId: string }
export function expenseCharges(expense: Expense): Charge[] {
  const net = new Map<string, number>()
  for (const payer of expense.payers) net.set(payer.memberId, payer.amount)
  for (const share of splitExpense(expense)) net.set(share.memberId, (net.get(share.memberId) ?? 0) - share.amount)
  const entries = [...net].sort(([a], [b]) => compareId(a, b))
  const debtors = entries.filter(([, amount]) => amount < 0)
  const creditors = entries.filter(([, amount]) => amount > 0)
  const charges: Charge[] = []
  let debtor = 0
  let creditor = 0
  while (debtor < debtors.length && creditor < creditors.length) {
    const [from, owed] = debtors[debtor]
    const [to, paid] = creditors[creditor]
    const amount = Math.min(-owed, paid)
    charges.push({ from, to, amount, expenseId: expense.id })
    debtors[debtor][1] += amount
    creditors[creditor][1] -= amount
    if (debtors[debtor][1] === 0) debtor++
    if (creditors[creditor][1] === 0) creditor++
  }
  return charges
}

type ChargeLine = Charge & { date: string; description: string; outstanding: number }
type PaymentLine = Payment & { applied: number; unapplied: number }
export type PairBalance = {
  from: string; to: string; charged: number; paid: number; outstanding: number; unapplied: number;
  charges: ChargeLine[]; payments: PaymentLine[];
}

const byDate = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  compareId(a.date, b.date) || compareId(a.id, b.id)

export function calculateBalances(expenses: Expense[], payments: Payment[]) {
  const pairs = new Map<string, PairBalance>()
  function pairFor(from: string, to: string) {
    const key = `${from}:${to}`
    let pair = pairs.get(key)
    if (!pair) {
      pair = { from, to, charged: 0, paid: 0, outstanding: 0, unapplied: 0, charges: [], payments: [] }
      pairs.set(key, pair)
    }
    return pair
  }
  for (const expense of [...expenses].sort(byDate)) {
    for (const charge of expenseCharges(expense)) {
      const pair = pairFor(charge.from, charge.to)
      pair.charges.push({ ...charge, date: expense.date, description: expense.description, outstanding: charge.amount })
      pair.charged += charge.amount
    }
  }
  for (const payment of [...payments].sort(byDate)) {
    pairFor(payment.from, payment.to).payments.push({ ...payment, applied: 0, unapplied: payment.amount })
  }
  for (const pair of pairs.values()) {
    let firstUnpaid = 0
    for (const payment of pair.payments) {
      while (payment.unapplied > 0 && firstUnpaid < pair.charges.length) {
        const charge = pair.charges[firstUnpaid]
        const amount = Math.min(charge.outstanding, payment.unapplied)
        charge.outstanding -= amount
        payment.applied += amount
        payment.unapplied -= amount
        if (!charge.outstanding) firstUnpaid++
      }
      pair.paid += payment.amount
      pair.unapplied += payment.unapplied
    }
    pair.outstanding = pair.charged - pair.paid + pair.unapplied
  }
  return [...pairs.values()].sort((a, b) => b.outstanding - a.outstanding || compareId(a.from, b.from) || compareId(a.to, b.to))
}

export function memberBalance(pairs: PairBalance[], memberId: string) {
  let owes = 0
  let owed = 0
  for (const pair of pairs) {
    if (pair.from === memberId) owes += pair.outstanding
    if (pair.to === memberId) owed += pair.outstanding
  }
  return { owes, owed, net: owed - owes }
}
