import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { monthCells, offsetMonth } from './calendar'
import { today, type Activity } from './model'
import { money } from './money'
import { transactions, TransactionRow, type LedgerRows } from './screens'
import { formatDay } from './ui'

const monthLabel = new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function ExpenseCalendar({ expenses, payments, currency, memberId, add, events, ...ledger }: LedgerRows & {
  memberId: string; events: Activity[]; add?: (date: string) => void;
}) {
  const currentDay = today()
  const [selected, setSelected] = useState(currentDay)
  const month = selected.slice(0, 7)
  const byDay = new Map<string, ReturnType<typeof transactions>>()
  let total = 0
  for (const item of transactions(expenses, payments)) {
    if (item.data.date.slice(0, 7) !== month) continue
    const records = byDay.get(item.data.date) ?? []
    records.push(item)
    byDay.set(item.data.date, records)
    if (item.type === 'expense') total += item.data.amount
  }
  const selectedRecords = byDay.get(selected) ?? []
  const previous = offsetMonth(month, -1)
  const next = offsetMonth(month, 1)
  function jump(targetMonth: string) {
    setSelected(targetMonth === currentDay.slice(0, 7) ? currentDay : `${targetMonth}-01`)
  }
  return <section aria-labelledby="calendar-heading">
    <header className="section-heading page-section-heading">
      <h2 id="calendar-heading">Calendar</h2>
      <button className="text-button" onClick={() => setSelected(currentDay)}>Today</button>
    </header>
    <section className="calendar-surface" aria-label="Monthly transaction calendar">
      <div className="calendar-toolbar">
        <button className="icon-button" aria-label="Previous month" onClick={() => jump(previous)} disabled={previous === month}><ChevronLeft size={20} /></button>
        <div aria-live="polite"><h3>{monthLabel.format(new Date(`${month}-01T00:00:00Z`))}</h3><p>{money(total, currency)} spent</p></div>
        <button className="icon-button" aria-label="Next month" onClick={() => jump(next)} disabled={next === month}><ChevronRight size={20} /></button>
      </div>
      <div className="calendar-grid">
        {days.map(day => <span className="calendar-weekday" key={day} aria-hidden="true">{day}</span>)}
        {monthCells(month).map((day, index) => {
          if (!day) return <span key={index} aria-hidden="true" />
          const count = byDay.get(day)?.length ?? 0
          return <button key={day} type="button" className="calendar-day" aria-pressed={selected === day}
            aria-current={day === currentDay ? 'date' : undefined} onClick={() => setSelected(day)}
            aria-label={`${formatDay(day, true)}, ${count} ${count === 1 ? 'transaction' : 'transactions'}`}>
            <span>{Number(day.slice(8))}</span>
            {count > 0 && <small><i />{count}</small>}
          </button>
        })}
      </div>
    </section>
    <div className="section-heading section-block">
      <h3>{formatDay(selected, true)}</h3>
      {add && <button className="text-button" onClick={() => add(selected)}><Plus size={16} />Add on this date</button>}
    </div>
    {selectedRecords.length > 0 ? <div className="list-surface">
      {selectedRecords.map(item => <TransactionRow key={item.type + ":" + item.data.id} item={item} events={events} currency={currency} memberId={memberId} {...ledger} />)}
    </div> : <p className="calendar-empty muted">No transactions recorded for this day.</p>}
  </section>
}
