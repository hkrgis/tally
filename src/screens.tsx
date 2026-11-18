import { useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Camera, ChevronDown, Download, ListFilter, Pencil, Plus, ReceiptText, Search, Wallet } from 'lucide-react'
import { categories, type Activity, type Expense, type Member, type Payment } from './model'
import { decimal, expenseCharges, memberBalance, money, splitExpense, type PairBalance } from './money'
import { download, toCsv } from './storage'
import { CategoryIcon, Empty, Explanation, formatDay, formatEventTime, OwedIcon, OwesIcon, PaymentIcon } from './ui'

export const methodLabels = { equal: 'Equal', percentage: 'Percentage', exact: 'Exact amounts', weighted: 'Weighted shares' }
type Common = { currency: string; nameOf: (id: string) => string }
export type LedgerRows = Common & {
  expenses: Expense[]; payments: Payment[]; canEdit: boolean;
  editExpense: (expense: Expense) => void; editPayment: (payment: Payment) => void;
}
type Transaction = { type: 'expense'; data: Expense } | { type: 'payment'; data: Payment }
const transactions = (expenses: Expense[], payments: Payment[]): Transaction[] => [
  ...expenses.map(data => ({ type: 'expense' as const, data })),
  ...payments.map(data => ({ type: 'payment' as const, data })),
].sort((left, right) => right.data.date.localeCompare(left.data.date) || left.data.id.localeCompare(right.data.id))

function ExpenseBreakdown({ expense, currency, nameOf }: Common & { expense: Expense }) {
  const charges = expenseCharges(expense)
  return <>
    <div className="breakdown-grid">
      <div><h4>Paid by</h4>{expense.payers.map(payer => <div className="line" key={payer.memberId}><span>{nameOf(payer.memberId)}</span><strong>{money(payer.amount, currency)}</strong></div>)}</div>
      <div><h4>Split · {methodLabels[expense.split.method]}</h4>{splitExpense(expense).map((share, index) => {
        const value = expense.split.participants[index].amount
        const rule = expense.split.method === 'percentage' ? ` (${value / 100}%)` : expense.split.method === 'weighted' ? ` (${value} shares)` : ''
        return <div className="line" key={share.memberId}><span>{nameOf(share.memberId)}{rule}</span><strong>{money(share.amount, currency)}</strong></div>
      })}</div>
    </div>
    <h4>Original debts</h4>
    {charges.length ? charges.map(charge => <div className="line" key={`${charge.from}:${charge.to}`}>
      <span>{nameOf(charge.from)} <span aria-label="owes">→</span> {nameOf(charge.to)}</span><strong>{money(charge.amount, currency)}</strong>
    </div>) : <p className="muted">Everyone covered their own share.</p>}
    {expense.notes && <div><h4>Notes</h4><p className="record-note">{expense.notes}</p></div>}
    {Boolean(expense.photos?.length) && <div>
      <h4>Photos and receipts</h4>
      <ul className="receipt-photos">{expense.photos?.map(photo => <li key={photo.id}>
        <img src={photo.source} alt={photo.name} loading="lazy" />
        <small>{photo.name}</small>
      </li>)}</ul>
    </div>}
  </>
}

export function TransactionRow({ item, currency, nameOf, canEdit, editExpense, editPayment, showDate, memberId }: Omit<LedgerRows, 'expenses' | 'payments'> & {
  item: Transaction; showDate?: boolean; memberId?: string;
}) {
  if (item.type === 'payment') {
    const payment = item.data
    return <details className="transaction">
      <summary>
        <PaymentIcon />
        <span className="transaction-text"><strong>Reimbursement</strong>
          <small>{nameOf(payment.from)} <span aria-label="paid">→</span> {nameOf(payment.to)}{showDate && <> <span className="middot">·</span> {formatDay(payment.date)}</>}</small>
        </span>
        <span className="transaction-amount">{money(payment.amount, currency)}</span>
        <ChevronDown size={16} className="chevron" aria-hidden="true" />
      </summary>
      <div className="breakdown">
        <p>{nameOf(payment.from)} paid {nameOf(payment.to)} on {formatDay(payment.date, true)}.</p>
        {payment.notes && <p className="record-note">{payment.notes}</p>}
        {canEdit && <button className="button button-small" onClick={() => editPayment(payment)}><Pencil size={15} />Edit payment</button>}
      </div>
    </details>
  }
  const expense = item.data
  const payers = expense.payers.map(payer => nameOf(payer.memberId)).join(', ')
  const personalShare = memberId ? splitExpense(expense).find(share => share.memberId === memberId) : undefined
  return <details className="transaction">
    <summary>
      <CategoryIcon category={expense.category} />
      <span className="transaction-text"><strong>{expense.description}</strong>
        <small><span className="payer-line">{payers} paid</span><span className="middot">·</span>{showDate ? formatDay(expense.date) : `${expense.split.participants.length} ${expense.split.participants.length === 1 ? 'share' : 'shares'}`}
          {Boolean(expense.photos?.length) && <span className="photo-counter" aria-label={`${expense.photos?.length} attached photos`}><Camera size={13} aria-hidden="true" />{expense.photos?.length}</span>}
        </small>
      </span>
      <span className="transaction-amount">{money(expense.amount, currency)}
        {personalShare && !showDate && <small>Your share {money(personalShare.amount, currency)}</small>}
      </span>
      <ChevronDown size={16} className="chevron" aria-hidden="true" />
    </summary>
    <div className="breakdown">
      <ExpenseBreakdown expense={expense} currency={currency} nameOf={nameOf} />
      {canEdit && <button className="button button-small" onClick={() => editExpense(expense)}><Pencil size={15} />Edit expense</button>}
    </div>
  </details>
}

export function Overview({ currency, pairs, members, memberId, selectMember, openExpenses, openSessions, ...ledger }: LedgerRows & {
  pairs: PairBalance[]; members: Member[]; memberId: string; selectMember: (id: string) => void;
  openExpenses: () => void; openSessions: () => void;
}) {
  const { owes, owed, net } = memberBalance(pairs, memberId)
  const recent = transactions(ledger.expenses, ledger.payments).slice(0, 5)
  return <>
    <section className="summary-panel" aria-labelledby="summary-title">
      <div className="summary-heading">
        <div className="summary-title"><Wallet size={17} aria-hidden="true" /><h2 id="summary-title">Your balance</h2></div>
        {members.length > 0 && <label className="identity">
          <span>Viewing as</span>
          <select aria-label="Viewing as" value={memberId} onChange={event => selectMember(event.target.value)}>
            {members.map(member => <option value={member.id} key={member.id}>{member.name}{member.active ? '' : ' (inactive)'}</option>)}
          </select>
        </label>}
      </div>
      <dl className="metrics">
        <div><dt><OwesIcon />You owe</dt><dd>{money(owes, currency)}</dd></div>
        <div><dt><OwedIcon />Owed to you</dt><dd>{money(owed, currency)}</dd></div>
        <div><dt>Net balance</dt><dd className={net < 0 ? 'negative' : 'positive'}>{net > 0 ? '+' : ''}{money(net, currency)}</dd></div>
      </dl>
    </section>
    <section className="section-block" aria-labelledby="recent-title">
      <header className="section-heading"><h2 id="recent-title">Recent transactions</h2>
        <button className="text-button" onClick={openExpenses}>All expenses <ArrowRight size={16} /></button>
      </header>
      {recent.length ? <div className="list-surface">{recent.map(item =>
        <TransactionRow key={`${item.type}:${item.data.id}`} item={item} currency={currency} {...ledger} showDate />)}</div>
        : <Empty title="No transactions yet">Expenses and reimbursements for this group will appear here.</Empty>}
    </section>
    <button className="session-link" onClick={openSessions}>
      <span className="tile tone-green"><CalendarDays size={19} aria-hidden="true" /></span>
      <span><strong>Sports sessions</strong><small>Manage recurring court bookings and attendance.</small></span>
      <ArrowRight size={17} aria-hidden="true" />
    </button>
  </>
}

export function Expenses({ memberId, ...ledger }: LedgerRows & { memberId: string }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState('all')
  const { expenses, payments, currency, nameOf } = ledger
  const query = search.trim().toLowerCase()
  const matched = transactions(kind === 'payment' ? [] : expenses, category || kind === 'expense' ? [] : payments).filter(item => {
    if (item.type === 'payment') return `reimbursement ${nameOf(item.data.from)} ${nameOf(item.data.to)} ${item.data.notes}`.toLowerCase().includes(query)
    const expense = item.data
    return (!category || expense.category === category) &&
      [expense.description, expense.category, expense.notes, ...expense.payers.map(payer => nameOf(payer.memberId)),
        ...expense.split.participants.map(participant => nameOf(participant.memberId))].join(' ').toLowerCase().includes(query)
  })
  const groups = new Map<string, Transaction[]>()
  for (const item of matched) {
    const grouped = groups.get(item.data.date) ?? []
    grouped.push(item)
    groups.set(item.data.date, grouped)
  }
  const categoryTotals = new Map<string, number>()
  for (const item of matched) {
    if (item.type !== 'expense') continue
    const { category, amount } = item.data
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + amount)
  }
  function exportCsv() {
    const rows = matched.map((item): (string | number)[] => item.type === 'expense'
      ? ['Expense', item.data.date, item.data.description, item.data.category,
        item.data.payers.map(payer => `${nameOf(payer.memberId)} ${decimal(payer.amount, currency)}`).join(', '),
        splitExpense(item.data).map(share => `${nameOf(share.memberId)} ${decimal(share.amount, currency)}`).join(', '),
        Number(decimal(item.data.amount, currency)), currency, item.data.notes]
      : ['Payment', item.data.date, 'Reimbursement', '', nameOf(item.data.from), nameOf(item.data.to),
        Number(decimal(item.data.amount, currency)), currency, item.data.notes])
    download('tally-transactions.csv', toCsv([['Type', 'Date', 'Description', 'Category', 'Paid by', 'Shares or recipient', 'Amount', 'Currency', 'Notes'], ...rows]), 'text/csv;charset=utf-8')
  }
  return <section aria-labelledby="expenses-title">
    <header className="section-heading page-section-heading"><h2 id="expenses-title">Expenses</h2>
      <button className="button button-small" onClick={exportCsv} disabled={!matched.length}><Download size={16} />Export CSV</button>
    </header>
    <div className="filters">
      <label className="search-field"><Search size={18} aria-hidden="true" /><input type="search" placeholder="Search transactions" aria-label="Search transactions" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="filter-selects">
        <label className="filter-field"><ListFilter size={16} aria-hidden="true" /><select aria-label="Transaction type" value={kind} onChange={event => { setKind(event.target.value); if (event.target.value === 'payment') setCategory('') }}>
          <option value="all">All types</option><option value="expense">Expenses</option><option value="payment">Payments</option>
        </select></label>
        <label className="filter-field"><select aria-label="Category" value={category} disabled={kind === 'payment'} onChange={event => setCategory(event.target.value)}>
          <option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>
    </div>
    {categoryTotals.size > 0 && <Explanation title={`Spending total · ${money([...categoryTotals.values()].reduce((total, value) => total + value, 0), currency)}`}>
      {Array.from(categoryTotals, ([label, total]) => <div className="line" key={label}><span>{label}</span><strong>{money(total, currency)}</strong></div>)}
    </Explanation>}
    {[...groups].map(([date, items]) => <section className="date-group" key={date}>
      <h3><time dateTime={date}>{formatDay(date, true)}</time></h3>
      <div className="list-surface">{items.map(item =>
        <TransactionRow key={`${item.type}:${item.data.id}`} item={item} memberId={memberId} {...ledger} />)}</div>
    </section>)}
    {matched.length === 0 && <Empty title={search || category || kind !== 'all' ? 'No matching transactions' : 'No transactions yet'}>
      {search || category || kind !== 'all' ? 'Try another search or clear the filters.' : 'Group expenses and payments will appear here.'}
    </Empty>}
  </section>
}

export function Balances({ pairs, currency, nameOf, canEdit, settle, editPayment }: Common & {
  pairs: PairBalance[]; canEdit: boolean; settle: (pair: PairBalance) => void; editPayment: (payment: Payment) => void;
}) {
  return <section aria-labelledby="balances-title">
    <header className="section-heading page-section-heading"><h2 id="balances-title">Balances</h2></header>
    <Explanation title="How balances are calculated">
      <p>Each expense credits what each person paid and subtracts their share. Split rounding gives leftover minor units to the largest fractional shares, with ties broken by stable member ID. For expenses with multiple payers, the remaining amounts are matched within that expense using stable member ID order.</p>
      <p>Payments reduce the oldest charges between the same two people in the same direction. Any excess appears as an unapplied payment. Your overview adds your outstanding debts and amounts owed to you, then shows the difference as your net balance.</p>
    </Explanation>
    {pairs.length === 0 ? <Empty title="No balances yet">Balances appear when one member covers a share for another.</Empty> : <div className="list-surface pair-list">
      {pairs.map(pair => <details className="transaction" key={`${pair.from}:${pair.to}`}>
        <summary>
          <span className="tile tone-lavender" aria-hidden="true"><ArrowUpRight size={20} /></span>
          <span className="transaction-text"><strong>{nameOf(pair.from)} <span aria-label="owes">→</span> {nameOf(pair.to)}</strong>
            <small>{money(pair.paid, currency)} paid{pair.unapplied > 0 && <> · {money(pair.unapplied, currency)} unapplied</>}</small>
          </span>
          <span className="transaction-amount">{money(pair.outstanding, currency)}<small>{pair.outstanding ? 'Outstanding' : 'Settled'}</small></span>
          <ChevronDown className="chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="breakdown">
          <div className="line"><span>Original total</span><strong>{money(pair.charged, currency)}</strong></div>
          <div className="line"><span>Payments applied</span><strong>−{money(pair.paid - pair.unapplied, currency)}</strong></div>
          <div className="line"><span>Outstanding</span><strong>{money(pair.outstanding, currency)}</strong></div>
          {pair.charges.length > 0 && <h4>Original expenses</h4>}
          {pair.charges.map(charge => <div className="line" key={charge.expenseId}>
            <span>{charge.description}<small>{formatDay(charge.date, true)} · {money(charge.outstanding, currency)} outstanding</small></span><strong>{money(charge.amount, currency)}</strong>
          </div>)}
          {pair.payments.length > 0 && <h4>Reimbursements</h4>}
          {pair.payments.map(payment => <div className="line" key={payment.id}>
            <span>{formatDay(payment.date, true)}<small>{payment.notes}{payment.notes && payment.unapplied > 0 && ' · '}{payment.unapplied > 0 && `${money(payment.unapplied, currency)} unapplied`}</small></span>
            <span className="inline-actions"><strong>{money(payment.amount, currency)}</strong>{canEdit &&
              <button className="icon-button" aria-label={`Edit payment on ${formatDay(payment.date, true)}`} onClick={() => editPayment(payment)}><Pencil size={16} /></button>}</span>
          </div>)}
          {canEdit && pair.outstanding > 0 && <button className="button button-small" onClick={() => settle(pair)}><Plus size={16} />Record payment</button>}
        </div>
      </details>)}
    </div>}
  </section>
}

export function ActivityFeed({ events }: { events: Activity[] }) {
  const sorted = [...events].reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return <section aria-labelledby="activity-title">
    <header className="section-heading page-section-heading"><h2 id="activity-title">Activity</h2><span className="muted inline-actions"><ArrowDown size={16} />Newest first</span></header>
    {sorted.length === 0 ? <Empty title="No activity yet">Changes to this group will appear here.</Empty> :
      <ol className="list-surface activity-list">{sorted.map(event => <li key={event.id}>
        <span className="tile tone-neutral" aria-hidden="true"><ReceiptText size={17} /></span>
        <div><strong>{event.title}</strong><p>{event.actor} {event.action} {event.entity === 'expense' ? 'an' : 'a'} {event.entity}</p><time dateTime={event.at}>{formatEventTime(event.at)}</time></div>
      </li>)}</ol>}
  </section>
}
