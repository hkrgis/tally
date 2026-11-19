import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CalendarDays, Camera, ChevronDown, Download, Ellipsis, List, ListFilter, Pencil, Search } from 'lucide-react'
import { categories, type Activity, type Expense, type Member, type Payment } from './model'
import { decimal, expenseCharges, memberBalance, money, splitExpense, type PairBalance } from './money'
import { download, toCsv } from './storage'
import { firstName } from './people'
import { CategoryIcon, Empty, Explanation, formatDay, formatEventTime, nameInitial, PaymentIcon, Sheet } from './ui'

export const methodLabels = { equal: 'Equal', percentage: 'Percentage', exact: 'Exact amounts', weighted: 'Weighted shares' }
type Common = { currency: string; nameOf: (id: string) => string }
export type LedgerRows = Common & {
  expenses: Expense[]; payments: Payment[]; canEdit: boolean;
  editExpense: (expense: Expense) => void; editPayment: (payment: Payment) => void;
}
type Transaction = { type: 'expense'; data: Expense } | { type: 'payment'; data: Payment }
export const transactions = (expenses: Expense[], payments: Payment[]): Transaction[] => [
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

export function TransactionRow({ item, currency, nameOf, canEdit, editExpense, editPayment, memberId, initiallyOpen, events = [] }: Omit<LedgerRows, 'expenses' | 'payments'> & {
  item: Transaction; memberId?: string; initiallyOpen?: boolean; events?: Activity[];
}) {
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!initiallyOpen) return
    const summary = disclosure.current?.querySelector<HTMLElement>('summary')
    summary?.focus({ preventScroll: true })
    summary?.scrollIntoView({ block: 'nearest' })
  }, [initiallyOpen])
  const history = events.filter(event => event.entity === item.type && event.entityId === item.data.id)
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
        {payment.receipt && <ul className="receipt-photos"><li>
          <img src={payment.receipt.source} alt={payment.receipt.name} loading="lazy" /><small>{payment.receipt.name}</small>
        </li></ul>}
        <TransactionHistory events={history} />
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
      <CategoryIcon category={expense.category} />
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
      <p className="muted">{formatDay(expense.date, true)} &middot; {expense.category}</p>
      <ExpenseBreakdown expense={expense} shares={shares} currency={currency} nameOf={nameOf} />
      <TransactionHistory events={history} />
      {canEdit && <button type="button" className="text-button expense-edit" onClick={() => editExpense(expense)}><Pencil size={16} />Edit expense</button>}
    </div>
  </details>
}

function TransactionHistory({ events }: { events: Activity[] }) {
  if (!events.length) return null
  return <details className="record-history"><summary>Recording history</summary>
    <ul>{[...events].reverse().map(event => <li key={event.id}>{formatEventTime(event.at)} &middot; {event.actor} {event.action} this record</li>)}</ul>
  </details>
}

export function Expenses({ memberId, fullNameOf, members, canExport, focusTransaction, calendar, changeView, renderCalendar, events, ...ledger }: LedgerRows & {
  memberId: string; fullNameOf: Common['nameOf']; members: Member[]; canExport: boolean; focusTransaction?: string;
  calendar: boolean; changeView: (calendar: boolean) => void; renderCalendar: (expenses: Expense[], payments: Payment[]) => ReactNode;
  events: Activity[];
}) {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [filters, setFilters] = useState({ category: '', participant: '', payer: '', start: '', end: '', method: '' })
  const { expenses, payments, currency, nameOf } = ledger
  const searchableName = (id: string) => nameOf(id) + ' ' + fullNameOf(id)
  const query = search.trim().toLowerCase()
  const methodOptions = [...new Set([...expenses, ...payments].map(item => item.paymentMethod).filter(Boolean))].sort()
  const filterCount = Object.values(filters).filter(Boolean).length
  const matched = transactions(kind === 'payment' ? [] : expenses, kind === 'expense' ? [] : payments).filter(item => {
    const { start, end, category, participant, payer, method } = filters
    const { date, notes, paymentMethod } = item.data
    if ((start && date < start) || (end && date > end) || (method && paymentMethod !== method)) return false
    if (item.type === 'payment') {
      const { from, to } = item.data
      return !category && (!payer || from === payer) && (!participant || from === participant || to === participant) &&
        ['reimbursement', searchableName(from), searchableName(to), paymentMethod, notes].join(' ').toLowerCase().includes(query)
    }
    const expense = item.data
    return (!category || expense.category === category) && (!payer || expense.payers.some(person => person.memberId === payer)) &&
      (!participant || expense.split.participants.some(person => person.memberId === participant)) &&
      [expense.description, expense.category, paymentMethod, notes, ...expense.payers.map(person => searchableName(person.memberId)),
        ...expense.split.participants.map(person => searchableName(person.memberId))].join(' ').toLowerCase().includes(query)
  })
  const byDate = new Map<string, Transaction[]>()
  for (const item of matched) {
    const grouped = byDate.get(item.data.date) ?? []
    grouped.push(item)
    byDate.set(item.data.date, grouped)
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
  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters(current => ({ ...current, [key]: value }))
  }
  const memberOptions = members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)
  return <section aria-labelledby="expenses-title">
    <header className="section-heading page-section-heading"><h2 id="expenses-title">Expenses</h2>
      {canExport && <button className="icon-button" onClick={() => setOverflowOpen(true)} aria-label="Expense actions" title="Expense actions"><Ellipsis size={20} /></button>}
    </header>
    <div className="workspace-card expense-toolbar">
      <div className="expense-search">
        <label className="search-field"><Search size={18} aria-hidden="true" /><input type="search" placeholder="Search transactions" aria-label="Search transactions" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button className="button" onClick={() => setFilterOpen(true)}><ListFilter size={17} />Filters{filterCount > 0 && <span>({filterCount})</span>}</button>
      </div>
      <div className="expense-view-controls">
        <div className="workspace-segmented" role="group" aria-label="Transaction type">
          {([['all', 'All'], ['expense', 'Expenses'], ['payment', 'Payments']] as const).map(([value, label]) =>
            <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}
        </div>
        <div className="workspace-segmented view-switch" role="group" aria-label="Transaction layout">
          <button type="button" aria-label="List" title="List" aria-pressed={!calendar} onClick={() => changeView(false)}><List size={18} /></button>
          <button type="button" aria-label="Calendar" title="Calendar" aria-pressed={calendar} onClick={() => changeView(true)}><CalendarDays size={17} /></button>
        </div>
      </div>
    </div>
    {calendar ? renderCalendar(matched.flatMap(item => item.type === "expense" ? [item.data] : []),
      matched.flatMap(item => item.type === "payment" ? [item.data] : [])) : <>
      {[...byDate].map(([date, items]) => <section className="date-group" key={date}>
        <h3><time dateTime={date}>{formatDay(date, true)}</time></h3>
        <div className="list-surface">{items.map(item => <TransactionRow key={item.type + ":" + item.data.id} item={item} memberId={memberId}
          events={events} initiallyOpen={focusTransaction === item.type + ":" + item.data.id || undefined} {...ledger} />)}</div>
      </section>)}
      {!matched.length && <Empty title={search || filterCount || kind !== 'all' ? 'No matching transactions' : 'No transactions yet'}>
        {search || filterCount || kind !== 'all' ? 'Try another search or clear the filters.' : 'Group expenses and payments will appear here.'}
      </Empty>}
    </>}
    {filterOpen && <Sheet title="Filter transactions" close={() => setFilterOpen(false)}>
      <div className="form-stack">
        <label className="field"><span>Category</span><select value={filters.category} onChange={event => updateFilter("category", event.target.value)}>
          <option value="">Any category</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
        <div className="field-grid">
          <label className="field"><span>Participant</span><select value={filters.participant} onChange={event => updateFilter("participant", event.target.value)}>
            <option value="">Anyone</option>{memberOptions}</select></label>
          <label className="field"><span>Payer</span><select value={filters.payer} onChange={event => updateFilter("payer", event.target.value)}>
            <option value="">Anyone</option>{memberOptions}</select></label>
        </div>
        <div className="field-grid">
          <label className="field"><span>From date</span><input type="date" value={filters.start} max={filters.end || undefined} onChange={event => updateFilter("start", event.target.value)} /></label>
          <label className="field"><span>To date</span><input type="date" value={filters.end} min={filters.start || undefined} onChange={event => updateFilter("end", event.target.value)} /></label>
        </div>
        <label className="field"><span>Payment method</span><select value={filters.method} onChange={event => updateFilter("method", event.target.value)}>
          <option value="">Any method</option>{methodOptions.map(method => <option key={method}>{method}</option>)}</select></label>
        <div className="inline-actions">
          <button className="button" onClick={() => setFilters({ category: "", participant: "", payer: "", start: "", end: "", method: "" })}>Clear filters</button>
          <button className="button primary" onClick={() => setFilterOpen(false)}>Done</button>
        </div>
      </div>
    </Sheet>}
    {overflowOpen && <Sheet title="Expense actions" close={() => setOverflowOpen(false)}>
      <button className="button" disabled={!matched.length} onClick={() => { exportCsv(); setOverflowOpen(false) }}><Download size={17} />Export CSV</button>
    </Sheet>}
  </section>
}

export const pairKey = (pair: Pick<PairBalance, 'from' | 'to'>) => pair.from + ':' + pair.to
export const participates = (pair: Pick<PairBalance, 'from' | 'to'>, id: string) => pair.from === id || pair.to === id

export function Balances({ pairs, currency, nameOf, canEdit, settle, editPayment, memberId = '', members, focus }: Common & {
  pairs: PairBalance[]; canEdit: boolean; settle: (pair: PairBalance) => void; editPayment: (payment: Payment) => void;
  memberId?: string; members: Member[]; focus?: string;
}) {
  const focusedMember = focus?.startsWith('member:') ? members.find(member => member.id === focus.slice(7)) : undefined
  const subject = focusedMember?.id ?? memberId
  const [mine, setMine] = useState(Boolean(focusedMember))
  const [settled, setSettled] = useState(false)
  const focusedPair = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const summary = focusedPair.current?.querySelector<HTMLElement>('summary')
    summary?.focus({ preventScroll: true })
    summary?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  const myBalance = subject ? memberBalance(pairs, subject) : undefined
  const visible = pairs.filter(pair => (!mine || participates(pair, subject)) &&
    (settled || pair.outstanding > 0 || pair.unapplied > 0 || pairKey(pair) === focus))
  return <section aria-labelledby="balances-title">
    <header className="section-heading page-section-heading"><h2 id="balances-title">Balances</h2></header>
    {myBalance && <div className="workspace-card balance-summary">
      <h3>{subject === memberId ? 'My balance' : 'Balance for ' + nameOf(subject)}</h3>
      <div className="person-totals"><div><span>{subject === memberId ? 'You owe' : 'Owes'}</span><strong>{money(myBalance.owes, currency)}</strong></div>
        <div><span>{subject === memberId ? "You're owed" : 'Is owed'}</span><strong>{money(myBalance.owed, currency)}</strong></div></div>
    </div>}
    <div className="balance-controls">
      {subject && <div className="workspace-segmented" role="group" aria-label="Whose balances">
        <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>Everyone</button>
        <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>{subject === memberId ? 'My balances' : nameOf(subject)}</button>
      </div>}
      <label className="check-label"><input type="checkbox" checked={settled} onChange={event => setSettled(event.target.checked)} />Show settled history</label>
    </div>
    {visible.length === 0 ? <Empty title={pairs.length ? 'No outstanding balances' : 'No balances yet'}>
      {pairs.length ? 'Turn on settled history to see past balances.' : 'Balances appear when one member covers a share for another.'}
    </Empty> : <div className="list-surface pair-list">
      <div className="pair-labels" aria-hidden="true"><span>Owes from</span><span>Owed to</span><span>Outstanding amount</span></div>
      {visible.map(pair => <div className="pair-entry" key={pairKey(pair)}>
        <details className="transaction pair-row" open={pairKey(pair) === focus || undefined}
          ref={pairKey(pair) === focus ? focusedPair : undefined}>
          <summary>
            <span className="pair-person"><small>Owes from</small><strong>{nameOf(pair.from)}</strong></span>
            <span className="pair-person"><small>Owed to</small><strong>{nameOf(pair.to)}</strong></span>
            <span className="transaction-amount">{money(pair.outstanding, currency)}<small>{pair.outstanding ? 'Outstanding' : 'Settled'}
              {pair.unapplied > 0 && <span> &middot; {money(pair.unapplied, currency)} unapplied</span>}</small></span>
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
          </div>
        </details>
        {canEdit && pair.outstanding > 0 && <button className="text-button pair-settle" onClick={() => settle(pair)}>
          <ArrowUpRight size={15} />Settle up<span className="sr-only"> from {nameOf(pair.from)} to {nameOf(pair.to)}</span></button>}
      </div>)}
    </div>}
    <Explanation title="How balances are calculated">
      <p>Amounts come from each expense's recorded shares. Rounding is allocated in minor currency units. Reimbursements reduce the oldest charges between the same payer and recipient. Excess payments are listed as unapplied.</p>
    </Explanation>
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
