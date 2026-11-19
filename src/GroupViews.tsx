
import { useState } from 'react'
import { ArrowRight, ArrowLeftRight, ChevronRight, History, Plus } from 'lucide-react'
import { type Activity, type Member } from './model'
import { balanceLabel, memberBalance, money, type PairBalance } from './money'
import { ActivityFeed, pairKey, participates, transactions, TransactionRow, type LedgerRows } from './screens'
import { Avatar, CategoryIcon, Empty, formatDay, PaymentIcon } from './ui'

export function MemberBalanceSummary({ pairBalances, id, currency }: {
  pairBalances: PairBalance[]; id: string; currency: string;
}) {
  const { owes, owed } = memberBalance(pairBalances, id)
  return <div className="summary-amounts">
    <div><span>You owe</span><strong>{money(owes, currency)}</strong></div>
    <div><span>You're owed</span><strong>{money(owed, currency)}</strong></div>
  </div>
}

export function GroupHome({ pairs, members, memberId, events, go, settle, add, ...ledger }: LedgerRows & {
  pairs: PairBalance[]; members: Member[]; memberId: string; events: Activity[];
  go: (view: 'expenses' | 'balances' | 'people' | 'activity', focus?: string) => void;
  settle?: (pair: PairBalance) => void; add?: () => void;
}) {
  const [perspective, setPerspective] = useState('')
  const { currency, expenses, payments, nameOf } = ledger
  const selected = members.find(member => member.id === (memberId || perspective))
  const activeMembers = members.filter(member => member.active)
  const outstanding = pairs.filter(pair => pair.outstanding > 0)
  const recordedAt = new Map(events.filter(event => event.action === 'created').map(event => [`${event.entity}:${event.entityId}`, event.at]))
  const recent = transactions(expenses, payments).sort((a, b) => b.data.date.localeCompare(a.data.date) ||
    (recordedAt.get(`${b.type}:${b.data.id}`) ?? '').localeCompare(recordedAt.get(`${a.type}:${a.data.id}`) ?? '')).slice(0, 4)
  const spending = new Map<string, number>()
  for (const expense of expenses) spending.set(expense.category, (spending.get(expense.category) ?? 0) + expense.amount)
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const personal = selected && memberBalance(pairs, selected.id)
  return <>
    <div className="group-home-grid">
      <div className="home-column">
        <section className="personal-surface" aria-labelledby="personal-title">
          <h2 id="personal-title">{memberId ? 'Your balance' : selected ? `Balance for ${nameOf(selected.id)}` : 'Member balance'}</h2>
          {selected && personal && (memberId ? <MemberBalanceSummary pairBalances={pairs} id={selected.id} currency={currency} /> :
            <div className="summary-amounts"><div><span>Owes</span><strong>{money(personal.owes, currency)}</strong></div>
              <div><span>Is owed</span><strong>{money(personal.owed, currency)}</strong></div></div>)}
          {!memberId && (activeMembers.length ? <label className="balance-perspective">
            <span>{selected ? 'View another member' : 'Choose a member to see their balance'}</span>
            <select value={selected?.id ?? ''} onChange={event => setPerspective(event.target.value)}>
              <option value="">Select member</option>
              {activeMembers.map(member => <option key={member.id} value={member.id}>{nameOf(member.id)}</option>)}
            </select>
          </label> : <p>No members to show yet.</p>)}
          {selected && personal && <div className="personal-footer">
            <span>{personal.net ? 'Net balance ' + money(personal.net, currency) : personal.owes ? 'Equal incoming and outgoing balances' : 'All settled'}</span>
            <button className="text-button" type="button" onClick={() => go('balances', `member:${selected.id}`)}>View balances <ArrowRight size={15} /></button>
          </div>}
        </section>
        <section className="workspace-card" aria-labelledby="latest-title">
          <header className="section-heading"><h2 id="latest-title">Recent transactions</h2>
            <button className="text-button" onClick={() => go('expenses')}>View all <ArrowRight size={15} /></button>
          </header>
          {recent.length ? <ul className="home-rows">{recent.map(item => {
            const key = `${item.type}:${item.data.id}`
            const title = item.type === 'expense' ? item.data.description : 'Reimbursement'
            const subtitle = item.type === 'expense' ? `Paid by ${item.data.payers.map(payer => nameOf(payer.memberId)).join(', ')}` :
              `${nameOf(item.data.from)} paid ${nameOf(item.data.to)}`
            return <li key={key}><button className="recent-row" onClick={() => go('expenses', key)}>
              {item.type === 'expense' ? <CategoryIcon category={item.data.category} /> : <PaymentIcon />}
              <span className="transaction-text"><strong>{title}</strong><small>{subtitle} &middot; {formatDay(item.data.date)}</small></span>
              <strong className={item.type === 'payment' ? 'transaction-amount positive' : 'transaction-amount'}>{money(item.data.amount, currency)}</strong>
            </button></li>
          })}</ul> : <Empty title="No transactions yet">
            {add ? 'Add the first expense to start tracking what everyone paid.' : 'Group expenses and reimbursements will appear here.'}
          </Empty>}
        </section>
      </div>
      <div className="home-column">
        <section className="workspace-card" aria-labelledby="outstanding-title">
          <header className="section-heading"><h2 id="outstanding-title">Who owes whom</h2>
            {outstanding.length > 0 && <button className="text-button" onClick={() => go('balances')}>See all</button>}
          </header>
          {outstanding.length ? <ul className="home-rows">{outstanding.slice(0, 4).map(pair => {
            const member = members.find(item => item.id === pair.from)
            return <li key={pairKey(pair)}><button className="recent-row" onClick={() => go('balances', pairKey(pair))}>
              {member && <Avatar member={member} index={members.indexOf(member)} />}
              <span className="transaction-text"><strong>{nameOf(pair.from)} <span aria-label="owes">&rarr;</span> {nameOf(pair.to)}</strong><small>Outstanding</small></span>
              <strong className="transaction-amount">{money(pair.outstanding, currency)}</strong>
            </button></li>
          })}</ul> : <p className="muted compact-empty">No outstanding balances.</p>}
          {settle && outstanding.length > 0 && <button className="button settle-preview"
            onClick={() => outstanding.length === 1 ? settle(outstanding[0]) : go('balances')}>
            <ArrowLeftRight size={16} aria-hidden="true" />Settle up
          </button>}
        </section>
        {total > 0 && <section className="workspace-card group-spending" aria-labelledby="spend-title">
          <h2 id="spend-title">Group spending</h2>
          <strong className="spending-total">{money(total, currency)}</strong>
          <p className="muted">{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}</p>
          <ul>{[...spending].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([category, amount]) => <li key={category}>
            <div className="line"><span>{category}</span><strong>{money(amount, currency)}</strong></div>
            <div className="spending-track" aria-hidden="true"><span style={{ width: `${amount / total * 100}%` }} /></div>
          </li>)}</ul>
        </section>}
      </div>
    </div>
    <div className="home-audit">
      <ActivityFeed events={events} limit={5} />
      <button className="text-button" onClick={() => go('activity')}><History size={16} />Activity log</button>
    </div>
  </>
}

export function People({ pairs, members, memberId, ownerId, focus, select, seeBalances, manage, add, ...ledger }: LedgerRows & {
  pairs: PairBalance[]; members: Member[]; memberId: string; ownerId: string; focus?: string;
  select: (id?: string) => void; seeBalances: (id: string) => void;
  manage?: () => void; add?: () => void;
}) {
  const selected = members.find(member => member.id === focus)
  const { currency, nameOf, expenses, payments } = ledger
  if (selected) {
    const { owes, owed, net } = memberBalance(pairs, selected.id)
    const related = transactions(expenses.filter(expense => expense.payers.some(payer => payer.memberId === selected.id) ||
      expense.split.participants.some(person => person.memberId === selected.id)), payments.filter(payment => participates(payment, selected.id)))
    return <section aria-labelledby="person-title">
      <button className="text-button" onClick={() => select()}>Back to people</button>
      <header className="section-heading page-section-heading"><h2 id="person-title">{selected.name}</h2>
        <button className="text-button" onClick={() => seeBalances(selected.id)}>View balances <ArrowRight size={16} /></button>
      </header>
      <div className="workspace-card person-totals">
        <div><span>Owes</span><strong>{money(owes, currency)}</strong></div>
        <div><span>Is owed</span><strong>{money(owed, currency)}</strong></div>
        <div><span>Net balance</span><strong>{net === 0 && owes > 0 ? money(0, currency) : balanceLabel(net, currency)}</strong></div>
      </div>
      <h3 className="person-history-title">Transaction history</h3>
      {related.length ? <div className="list-surface">{related.map(item => <TransactionRow key={`${item.type}:${item.data.id}`}
        item={item} memberId={memberId} {...ledger} />)}</div> : <Empty title="No transactions yet">Expenses and payments involving {nameOf(selected.id)} will appear here.</Empty>}
    </section>
  }
  return <section aria-labelledby="people-title">
    <header className="section-heading page-section-heading"><h2 id="people-title">People</h2>
      <div className="inline-actions">
        {manage && <button className="text-button" onClick={manage}>Manage members</button>}
        {add && <button className="button button-small" onClick={add}><Plus size={16} />Add members</button>}
      </div>
    </header>
    {members.length ? <div className="workspace-card roster-surface">
      <table className="people-table" role="table">
        <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Member</th><th scope="col" role="columnheader">Owes</th><th scope="col" role="columnheader">Is owed</th><th scope="col" role="columnheader">Net balance</th></tr></thead>
        <tbody role="rowgroup">{members.map((member, index) => {
          const { owes, owed, net } = memberBalance(pairs, member.id)
          const role = [member.id === memberId ? 'You' : '', member.id === ownerId ? 'Owner' : '', member.active ? '' : 'Inactive'].filter(Boolean).join(' / ')
          return <tr role="row" key={member.id}><th role="rowheader" scope="row"><button className="person-link" onClick={() => select(member.id)}>
            <Avatar member={member} index={index} /><span>{member.name}{role && <small>{role}</small>}</span><ChevronRight size={15} aria-hidden="true" />
          </button></th>
            <td role="cell"><span className="mobile-data-label" aria-hidden="true">Owes</span>{money(owes, currency)}</td>
            <td role="cell"><span className="mobile-data-label" aria-hidden="true">Is owed</span>{money(owed, currency)}</td>
            <td className={net < 0 ? 'negative' : net > 0 ? 'positive' : 'muted'}><span className="mobile-data-label" aria-hidden="true">Net balance</span>{net === 0 && owes > 0 ? money(0, currency) : balanceLabel(net, currency)}</td>
          </tr>
        })}</tbody>
      </table>
    </div> : <Empty title="No members yet">Group members will appear here.</Empty>}
  </section>
}
