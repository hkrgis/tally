import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, Camera, ChevronDown, ChevronRight, Download, ListFilter, Pencil, Plus, ReceiptText, Search } from 'lucide-react'
import { categories, type Activity, type Expense, type Member, type Payment } from './model'
import { balanceLabel, decimal, expenseCharges, memberBalance, memberExpenseTotals, money, settlementPairs, splitExpense, type PairBalance } from './money'
import { download, toCsv } from './storage'
import { firstName } from './people'
import { Avatar, CategoryIcon, Empty, Explanation, formatDay, formatEventTime, nameInitial, PaymentIcon } from './ui'

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

function ExpenseBreakdown({ expense, shares, currency, nameOf }: Common & { expense: Expense; shares: ReturnType<typeof splitExpense> }) {
  const charges = expenseCharges(expense)
  const method = expense.split.method
  const splitLabel = method === 'equal' || method === 'percentage' ? methodLabels[method] : `Custom · ${methodLabels[method]}`
  return <>
    <section className="expense-section">
      <div className="expense-section-heading">
        <h4>Paid by</h4>
        {expense.paymentMethod && <span>{expense.paymentMethod}</span>}
      </div>
      <dl>{expense.payers.map(payer => <div className="expense-detail-row" key={payer.memberId}>
        <dt>{nameOf(payer.memberId)}</dt><dd>{money(payer.amount, currency)}</dd>
      </div>)}</dl>
    </section>
    <section className="expense-section expense-split">
      <div className="expense-section-heading">
        <h4>Split between {shares.length} {shares.length === 1 ? 'person' : 'people'}</h4>
        <span>{splitLabel}</span>
      </div>
      <ul aria-label="Participants">{shares.map((share, index) => {
        const name = nameOf(share.memberId)
        const value = expense.split.participants[index].amount
        const rule = method === 'percentage' ? `${value / 100}%` : method === 'weighted' ? `${value} ${value === 1 ? 'share' : 'shares'}` : ''
        return <li className="expense-detail-row" key={share.memberId}>
          <span className="expense-participant">
            <span className="expense-initials" aria-hidden="true">{nameInitial(name)}</span>
            <span>{name}{rule && <small>{rule}</small>}</span>
          </span>
          <strong>{money(share.amount, currency)}</strong>
        </li>
      })}</ul>
    </section>
    <section className="expense-section expense-debts">
      <div className="expense-section-heading"><h4>Original debts</h4></div>
      {charges.length ? <dl>{charges.map(charge => <div className="expense-detail-row" key={`${charge.from}:${charge.to}`}>
        <dt>{nameOf(charge.from)} <span aria-label="owes">→</span> {nameOf(charge.to)}</dt><dd>{money(charge.amount, currency)}</dd>
      </div>)}</dl> : <p className="muted">Everyone covered their own share.</p>}
    </section>
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

export function TransactionRow({ item, currency, nameOf, canEdit, editExpense, editPayment, memberId, initiallyOpen }: Omit<LedgerRows, 'expenses' | 'payments'> & {
  item: Transaction; memberId?: string; initiallyOpen?: boolean;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!initiallyOpen) return
    const summary = disclosure.current?.querySelector<HTMLElement>('summary')
    summary?.focus({ preventScroll: true })
    summary?.scrollIntoView({ block: 'nearest' })
  }, [initiallyOpen])
  if (item.type === 'payment') {
    const payment = item.data
    return <details className="transaction" ref={disclosure} open={initiallyOpen}>
      <summary>
        <PaymentIcon />
        <span className="transaction-text"><strong>Reimbursement</strong>
          <small>{nameOf(payment.from)} <span aria-label="paid">→</span> {nameOf(payment.to)}{payment.paymentMethod && ` · ${payment.paymentMethod}`}</small>
        </span>
        <span className="transaction-amount">{money(payment.amount, currency)}</span>
        <ChevronDown size={16} className="chevron" aria-hidden="true" />
      </summary>
      <div className="breakdown">
        <p>{nameOf(payment.from)} paid {nameOf(payment.to)} on {formatDay(payment.date, true)}{payment.paymentMethod ? ` via ${payment.paymentMethod}` : ''}.</p>
        {payment.notes && <p className="record-note">{payment.notes}</p>}
        {canEdit && <button className="button button-small" onClick={() => editPayment(payment)}><Pencil size={15} />Edit payment</button>}
      </div>
    </details>
  }
  const expense = item.data
  const shares = splitExpense(expense)
  const payers = expense.payers.map(payer => nameOf(payer.memberId)).join(', ')
  const personalShare = shares.find(share => share.memberId === memberId)?.amount ?? 0
  return <details className="transaction expense-card" ref={disclosure} open={initiallyOpen}>
    <summary>
      <span className="tile tone-blue" aria-hidden="true"><ReceiptText size={20} strokeWidth={1.7} /></span>
      <span className="transaction-text"><strong>{expense.description}</strong>
        <small><span className="payer-line">{payers} paid</span><span className="middot">·</span>{methodLabels[expense.split.method]} split
          {Boolean(expense.photos?.length) && <span className="photo-counter" aria-label={`${expense.photos?.length} attached photos`}><Camera size={13} aria-hidden="true" />{expense.photos?.length}</span>}
        </small>
      </span>
      <span className="transaction-amount">{money(expense.amount, currency)}
        {memberId && <small>Your share {money(personalShare, currency)}</small>}
      </span>
      <ChevronDown size={16} className="chevron" aria-hidden="true" />
    </summary>
    <div className="breakdown expense-breakdown">
      <ExpenseBreakdown expense={expense} shares={shares} currency={currency} nameOf={nameOf} />
      {canEdit && <button type="button" className="text-button expense-edit" onClick={() => editExpense(expense)}><Pencil size={16} />Edit expense</button>}
    </div>
  </details>
}

export function Overview({ currency, pairs, members, settle, canEdit, openExpenses, openTransaction, events, ...ledger }: Common & {
  expenses: Expense[]; payments: Payment[]; events: Activity[];
  pairs: PairBalance[]; members: Member[]; canEdit: boolean; settle: (memberId: string) => void;
  openExpenses: () => void; openTransaction: (id: string) => void;
}) {
  const totals = memberExpenseTotals(ledger.expenses)
  const created = new Map(events.filter(event => event.action === 'created').map(event => [`${event.entity}:${event.entityId}`, event.at]))
  const recent = transactions(ledger.expenses, ledger.payments).sort((a, b) => b.data.date.localeCompare(a.data.date) ||
    (created.get(`${b.type}:${b.data.id}`) ?? '').localeCompare(created.get(`${a.type}:${a.data.id}`) ?? '')).slice(0, 5)
  return <>
    <section className="section-block" aria-labelledby="member-balances">
      <header className="section-heading"><h2 id="member-balances">Member balances</h2></header>
      {members.length ? <div className="list-surface balances-surface">
        <table className="member-balances" role="table" aria-labelledby="member-balances">
          <thead role="rowgroup"><tr role="row">
            <th scope="col" role="columnheader">Member</th>
            <th scope="col" role="columnheader">Paid</th>
            <th scope="col" role="columnheader">Share</th>
            <th scope="col" role="columnheader">Net Balance</th>
            <th scope="col" role="columnheader">Action</th>
          </tr></thead>
          <tbody role="rowgroup">{members.map((member, index) => {
            const { paid, share } = totals.get(member.id) ?? { paid: 0, share: 0 }
            const { net } = memberBalance(pairs, member.id)
            const outstanding = settlementPairs(pairs, member.id).length > 0
            const name = ledger.nameOf(member.id)
            return <tr key={member.id} role="row">
              <th scope="row" role="rowheader"><span className="balance-member"><Avatar member={member} index={index} />{name}</span></th>
              <td role="cell"><span className="balance-mobile-label" aria-hidden="true">Paid</span>{money(paid, currency)}</td>
              <td role="cell"><span className="balance-mobile-label" aria-hidden="true">Share</span>{money(share, currency)}</td>
              <td role="cell" className={net < 0 ? 'negative' : net > 0 ? 'positive' : 'muted'}>
                <span className="balance-mobile-label" aria-hidden="true">Net Balance</span><span>{balanceLabel(net, currency)}</span>
              </td>
              <td role="cell">{canEdit && outstanding && <button className="text-button" aria-label={`Settle up with ${name}`}
                onClick={() => settle(member.id)}>Settle Up</button>}</td>
            </tr>
          })}</tbody>
        </table>
      </div> : <Empty title="No members yet">Member balances will appear here.</Empty>}
    </section>
    <section className="section-block" aria-labelledby="recent-title">
      <header className="section-heading"><h2 id="recent-title">Recent transactions</h2>
        <button className="text-button" onClick={openExpenses}>All expenses <ArrowRight size={16} /></button>
      </header>
      {recent.length ? <ul className="recent-list">{recent.map(item => {
        const id = `${item.type}:${item.data.id}`
        const title = item.type === 'expense' ? item.data.description : `${ledger.nameOf(item.data.from)} → ${ledger.nameOf(item.data.to)}`
        const subtitle = item.type === 'expense' ? item.data.payers.map(payer => ledger.nameOf(payer.memberId)).join(', ') : 'Reimbursement'
        return <li key={id}><button className="recent-row" onClick={() => openTransaction(id)}>
          {item.type === 'expense' ? <CategoryIcon category={item.data.category} /> : <PaymentIcon />}
          <span className="transaction-text"><strong>{title}</strong>
            <small>{subtitle} · {formatDay(item.data.date)}{item.data.paymentMethod && ` · ${item.data.paymentMethod}`}</small>
          </span>
          <strong className="transaction-amount">{money(item.data.amount, currency)}</strong>
          <ChevronRight className="chevron" size={15} aria-hidden="true" />
        </button></li>
      })}</ul> : <p className="muted compact-empty">No transactions yet.</p>}
    </section>
    <ActivityFeed events={events} limit={5} />
  </>
}

export function Expenses({ memberId, fullNameOf, canExport, focusTransaction, ...ledger }: LedgerRows & {
  memberId: string; fullNameOf: Common['nameOf']; canExport: boolean; focusTransaction?: string;
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState('all')
  const { expenses, payments, currency, nameOf } = ledger
  const searchableName = (id: string) => `${nameOf(id)} ${fullNameOf(id)}`
  const query = search.trim().toLowerCase()
  const matched = transactions(kind === 'payment' ? [] : expenses, category || kind === 'expense' ? [] : payments).filter(item => {
    if (item.type === 'payment') return `reimbursement ${searchableName(item.data.from)} ${searchableName(item.data.to)} ${item.data.paymentMethod ?? ''} ${item.data.notes}`.toLowerCase().includes(query)
    const expense = item.data
    return (!category || expense.category === category) &&
      [expense.description, expense.category, expense.paymentMethod, expense.notes, ...expense.payers.map(payer => searchableName(payer.memberId)),
        ...expense.split.participants.map(participant => searchableName(participant.memberId))].join(' ').toLowerCase().includes(query)
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
        item.data.payers.map(payer => `${fullNameOf(payer.memberId)} ${decimal(payer.amount, currency)}`).join(', '),
        splitExpense(item.data).map(share => `${fullNameOf(share.memberId)} ${decimal(share.amount, currency)}`).join(', '),
        Number(decimal(item.data.amount, currency)), currency, item.data.paymentMethod ?? '', item.data.notes]
      : ['Payment', item.data.date, 'Reimbursement', '', fullNameOf(item.data.from), fullNameOf(item.data.to),
        Number(decimal(item.data.amount, currency)), currency, item.data.paymentMethod ?? '', item.data.notes])
    download('tally-transactions.csv', toCsv([['Type', 'Date', 'Description', 'Category', 'Paid by', 'Shares or recipient', 'Amount', 'Currency', 'Payment method', 'Notes'], ...rows]), 'text/csv;charset=utf-8')
  }
  return <section aria-labelledby="expenses-title">
    <header className="section-heading page-section-heading"><h2 id="expenses-title">Expenses</h2>
      {canExport && <button className="text-button" onClick={exportCsv} disabled={!matched.length}>
        <Download size={16} aria-hidden="true" />Export CSV
      </button>}
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
        <TransactionRow key={`${item.type}:${item.data.id}`} item={item} memberId={memberId}
          initiallyOpen={focusTransaction === `${item.type}:${item.data.id}` || undefined} {...ledger} />)}</div>
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
            <span>{formatDay(payment.date, true)}{payment.paymentMethod && ` · ${payment.paymentMethod}`}
              <small>{payment.notes}{payment.notes && payment.unapplied > 0 && ' · '}{payment.unapplied > 0 && `${money(payment.unapplied, currency)} unapplied`}</small></span>
            <span className="inline-actions"><strong>{money(payment.amount, currency)}</strong>{canEdit &&
              <button className="icon-button" aria-label={`Edit payment on ${formatDay(payment.date, true)}`} onClick={() => editPayment(payment)}><Pencil size={16} /></button>}</span>
          </div>)}
          {canEdit && pair.outstanding > 0 && <button className="button button-small" onClick={() => settle(pair)}><Plus size={16} />Record payment</button>}
        </div>
      </details>)}
    </div>}
  </section>
}

export function ActivityFeed({ events, limit }: { events: Activity[]; limit?: number }) {
  const sorted = events.filter(event => event.entity !== 'session').reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const content = sorted.length === 0 ? <Empty title="No activity yet">Changes to this group will appear here.</Empty> :
      <ol className="activity-list">{sorted.slice(0, limit ?? sorted.length).map(event => <li key={event.id}>
        <div><strong>{event.entity === 'member' ? firstName(event.title) : event.title}</strong>
          <p>{event.actor === 'Group owner' ? event.actor : firstName(event.actor)} {event.action} {event.entity === 'expense' ? 'an' : 'a'} {event.entity}</p></div>
        <time dateTime={event.at}>{formatEventTime(event.at)}</time>
      </li>)}</ol>
  if (limit !== undefined) return <details className="section-block recent-activity">
    <summary className="section-heading"><h2>Recent activity</h2><span className="muted">{sorted.length}<span className="sr-only"> events</span></span>
      <ChevronDown className="chevron" size={17} aria-hidden="true" /></summary>
    <div className="recent-activity-body">{content}</div>
  </details>
  return <section className="section-block" aria-labelledby="activity-title">
    <header className="section-heading page-section-heading"><h2 id="activity-title">Activity</h2></header>
    {content}
  </section>
}
