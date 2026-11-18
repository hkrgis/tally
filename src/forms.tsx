import { useState, type FormEvent, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { categories, currencies, frequencies, nextSessionDate, splitMethods, today, type AppData, type Expense, type Group, type Member, type Payment, type SportsSession } from './model'
import { calculateBalances, decimal, minorDigits, money, parseUnits, type PairBalance } from './money'
import { methodLabels } from './screens'
import { formatDay } from './ui'
import { errorText } from './useLedger'

type Field = { label: string; children: ReactNode }
function Field({ label, children }: Field) {
  return <label className="field"><span>{label}</span>{children}</label>
}

function RecordForm({ children, submit, submitLabel = 'Save to draft', remove }: {
  children: ReactNode; submit: () => void; submitLabel?: string; remove?: () => void;
}) {
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  function run(action: () => void) {
    setError('')
    try { action() } catch (issue) { setError(errorText(issue)) }
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    run(submit)
  }
  return <form className="form-stack" onSubmit={onSubmit}>
    {children}
    {error && <p className="notice danger" role="alert">{error}</p>}
    {confirm && <div className="notice danger">
      <p>Remove this record from the draft and add a correction to Activity?</p>
      <div className="inline-actions">
        <button type="button" className="button danger-button" onClick={() => remove && run(remove)}>Remove record</button>
        <button type="button" className="button" onClick={() => setConfirm(false)}>Keep record</button>
      </div>
    </div>}
    <footer className="form-footer">
      {remove && !confirm && <button type="button" className="text-button negative" onClick={() => setConfirm(true)}><Trash2 size={16} />Remove</button>}
      <button className="button primary" type="submit" disabled={confirm}>{submitLabel}</button>
    </footer>
  </form>
}

type RecordContext = { group: Group; members: Member[] }
type Choice = Record<string, string>
const fields = (entries: { memberId: string; amount: number }[], display: (amount: number) => string): Choice =>
  Object.fromEntries(entries.map(entry => [entry.memberId, display(entry.amount)]))
const choose = (choices: Choice, id: string, selected: boolean, value: string) => {
  const next = { ...choices }
  if (selected) next[id] = value
  else delete next[id]
  return next
}
const selected = (choices: Choice, id: string) => Object.hasOwn(choices, id)

export function ExpenseForm({ group, members, memberId, expense, session, occurrenceDate, save, remove }: RecordContext & {
  memberId: string; expense?: Expense; session?: SportsSession; occurrenceDate?: string;
  save: (expense: Expense) => void; remove?: () => void;
}) {
  const active = members.filter(member => member.active)
  const preferred = active.find(member => member.id === session?.payerId)?.id ??
    active.find(member => member.id === memberId)?.id ?? active[0]?.id
  const formatAmount = (value: number) => decimal(value, group.currency)
  const amountPlaceholder = formatAmount(0)
  const moneyDigits = minorDigits(group.currency)
  const [description, setDescription] = useState(expense?.description ?? session?.name ?? '')
  const [amount, setAmount] = useState(expense ? formatAmount(expense.amount) : session ? formatAmount(session.amount) : '')
  const [date, setDate] = useState(expense?.date ?? occurrenceDate ?? today())
  const [category, setCategory] = useState<Expense['category']>(expense?.category ?? (session ? 'Sports' : 'Other'))
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [method, setMethod] = useState(expense?.split.method ?? 'equal')
  function splitValue(value: number) {
    if (expense?.split.method === 'exact') return formatAmount(value)
    if (expense?.split.method === 'percentage') return String(value / 100)
    return String(value)
  }
  const [payers, setPayers] = useState<Choice>(expense ? fields(expense.payers, formatAmount) : preferred ? { [preferred]: amount } : {})
  const [participants, setParticipants] = useState<Choice>(expense ? fields(expense.split.participants, splitValue) :
    Object.fromEntries(active.filter(member => !session || session.attendeeIds.includes(member.id)).map(member => [member.id, '1'])))
  const available = members.filter(member => member.active || selected(payers, member.id) || selected(participants, member.id) ||
    expense?.payers.some(payer => payer.memberId === member.id) || expense?.split.participants.some(person => person.memberId === member.id))
  const payerCount = Object.keys(payers).length
  const splitLabel = method === 'percentage' ? 'Percentage' : method === 'exact' ? 'Share amount' : 'Weight'

  function submit() {
    const total = parseUnits(amount, moneyDigits)
    if (!total) throw new Error('Enter a total greater than zero.')
    if (!payerCount || !Object.keys(participants).length) throw new Error('Select at least one payer and participant.')
    const expensesPayers = Object.entries(payers).map(([id, value]) =>
      ({ memberId: id, amount: payerCount === 1 ? total : parseUnits(value, moneyDigits) }))
    const shares = Object.entries(participants).map(([id, value]) => ({ memberId: id,
      amount: method === 'equal' ? 1 : parseUnits(value, method === 'exact' ? moneyDigits : method === 'percentage' ? 2 : 0),
    }))
    if (expensesPayers.some(payer => !payer.amount) || expensesPayers.reduce((sum, payer) => sum + payer.amount, 0) !== total) {
      throw new Error('Enter each payer’s contribution. Contributions must add up to the total.')
    }
    if (method === 'percentage' && shares.reduce((sum, share) => sum + share.amount, 0) !== 10_000) throw new Error('Percentages must add up to 100%.')
    if (method === 'exact' && shares.reduce((sum, share) => sum + share.amount, 0) !== total) throw new Error('Share amounts must add up to the total.')
    if (method === 'weighted' && shares.some(share => !share.amount)) throw new Error('Each selected participant needs at least one share.')
    save({ id: expense?.id ?? crypto.randomUUID(), groupId: group.id, description, amount: total, date, category, notes,
      payers: expensesPayers, split: { method, participants: shares }, sessionId: expense?.sessionId ?? session?.id })
  }
  return <RecordForm submit={submit} remove={remove}>
    <Field label="Description"><input required maxLength={100} value={description} onChange={event => setDescription(event.target.value)} placeholder="e.g. Dinner for four" /></Field>
    <div className="form-grid">
      <Field label={`Total (${group.currency})`}><input inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder={amountPlaceholder} /></Field>
      <Field label="Date"><input type="date" required min={session && !expense ? session.startDate : undefined} value={date} onChange={event => setDate(event.target.value)} /></Field>
    </div>
    <Field label="Category"><select value={category} onChange={event => setCategory(event.target.value as Expense['category'])}>
      {categories.map(value => <option key={value}>{value}</option>)}
    </select></Field>
    <fieldset className="choice-group">
      <legend>Paid by</legend>
      {available.map(member => <div className="choice-row" key={member.id}>
        <label><input type="checkbox" checked={selected(payers, member.id)} onChange={event => setPayers(choose(payers, member.id, event.target.checked, payerCount ? '' : amount))} />{member.name}{!member.active && ' (inactive)'}</label>
        {selected(payers, member.id) && (payerCount === 1 ? <small>Full amount</small> :
          <input inputMode="decimal" aria-label={`Amount paid by ${member.name}`} required value={payers[member.id]} placeholder={amountPlaceholder} onChange={event => setPayers({ ...payers, [member.id]: event.target.value })} />)}
      </div>)}
      {available.length === 0 && <p>Add a group member before recording expenses.</p>}
    </fieldset>
    <Field label="Split method"><select value={method} onChange={event => {
      const next = event.target.value as Expense['split']['method']
      setMethod(next)
      setParticipants(Object.fromEntries(Object.keys(participants).map(id => [id, next === 'weighted' || next === 'equal' ? '1' : ''])))
    }}>
      {splitMethods.map(value => <option key={value} value={value}>{methodLabels[value]}</option>)}
    </select></Field>
    <fieldset className="choice-group">
      <legend>{session ? 'Attendees' : 'Participants'}</legend>
      {available.map(member => <div className="choice-row" key={member.id}>
        <label><input type="checkbox" checked={selected(participants, member.id)}
          onChange={event => setParticipants(choose(participants, member.id, event.target.checked, method === 'weighted' || method === 'equal' ? '1' : ''))} />
          {member.name}{!member.active && ' (inactive)'}</label>
        {selected(participants, member.id) && method !== 'equal' && <input required inputMode={method === 'weighted' ? 'numeric' : 'decimal'}
          aria-label={`${splitLabel} for ${member.name}`} value={participants[member.id]}
          onChange={event => setParticipants({ ...participants, [member.id]: event.target.value })} />}
      </div>)}
    </fieldset>
    <Field label="Notes (optional)"><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
  </RecordForm>
}

export function PaymentForm({ group, members, expenses, payments, pair, payment, save, remove }: RecordContext & {
  expenses: Expense[]; payments: Payment[]; pair?: PairBalance; payment?: Payment;
  save: (payment: Payment) => void; remove?: () => void;
}) {
  const [from, setFrom] = useState(payment?.from ?? pair?.from ?? '')
  const [to, setTo] = useState(payment?.to ?? pair?.to ?? '')
  const [date, setDate] = useState(payment?.date ?? today())
  const [notes, setNotes] = useState(payment?.notes ?? '')
  const [amount, setAmount] = useState(payment ? decimal(payment.amount, group.currency) : pair ? decimal(pair.outstanding, group.currency) : '')
  const pairs = calculateBalances(expenses, payments.filter(value => value.id !== payment?.id))
  const outstanding = pairs.find(value => value.from === from && value.to === to)?.outstanding ?? 0
  const ceiling = Math.max(outstanding, payment?.from === from && payment?.to === to ? payment.amount : 0)
  function submit() {
    const total = parseUnits(amount, minorDigits(group.currency))
    if (!from || !to || from === to) throw new Error('Select different members for the payer and recipient.')
    if (!total || total > ceiling) throw new Error(`Enter a payment greater than zero and up to ${money(ceiling, group.currency)}.`)
    save({ id: payment?.id ?? crypto.randomUUID(), groupId: group.id, from, to, amount: total, date, notes })
  }
  return <RecordForm submit={submit} remove={remove}>
    <div className="form-grid">
      <Field label="Paid by"><select required value={from} onChange={event => setFrom(event.target.value)}>
        <option value="">Select a member</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select></Field>
      <Field label="Paid to"><select required value={to} onChange={event => setTo(event.target.value)}>
        <option value="">Select a member</option>{members.filter(member => member.id !== from || member.id === to).map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select></Field>
    </div>
    {from && to && from !== to && <p className="notice">{money(outstanding, group.currency)} outstanding before this payment.</p>}
    <div className="form-grid">
      <Field label={`Amount (${group.currency})`}><input required value={amount} inputMode="decimal" onChange={event => setAmount(event.target.value)} /></Field>
      <Field label="Date"><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
    </div>
    <Field label="Notes (optional)"><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
  </RecordForm>
}

export function GroupForm({ group, currencyLocked, save }: { group?: Group; currencyLocked?: boolean; save: (group: Group) => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [currency, setCurrency] = useState(group?.currency ?? 'AUD')
  const [archived, setArchived] = useState(group?.archived ?? false)
  const names = new Intl.DisplayNames('en-AU', { type: 'currency' })
  return <RecordForm submit={() => save({ id: group?.id ?? crypto.randomUUID(), name, description, currency, archived })}>
    <Field label="Group name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="Description (optional)"><textarea rows={2} maxLength={240} value={description} onChange={event => setDescription(event.target.value)} /></Field>
    <Field label="Currency"><select disabled={currencyLocked} value={currency} onChange={event => setCurrency(event.target.value)}>
      {currencies.map(value => <option key={value} value={value}>{value} · {names.of(value)}</option>)}
    </select></Field>
    {currencyLocked && <p className="muted">This group’s records use {currency}.</p>}
    {group && <label className="check-line"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Archive group</label>}
  </RecordForm>
}

export function MemberForm({ group, member, save }: { group: Group; member?: Member; save: (member: Member) => void }) {
  const [name, setName] = useState(member?.name ?? '')
  const [active, setActive] = useState(member?.active ?? true)
  return <RecordForm submit={() => save({ id: member?.id ?? crypto.randomUUID(), groupId: group.id, name, active })}>
    <Field label="Name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
    {member && <label className="check-line"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Available for new expenses</label>}
  </RecordForm>
}

export function SessionForm({ group, members, session, save }: RecordContext & {
  session?: SportsSession; save: (session: SportsSession) => void;
}) {
  const available = members.filter(member => member.active || member.id === session?.payerId || session?.attendeeIds.includes(member.id))
  const [name, setName] = useState(session?.name ?? '')
  const [amount, setAmount] = useState(session ? decimal(session.amount, group.currency) : '')
  const [startDate, setStartDate] = useState(session?.startDate ?? today())
  const [frequency, setFrequency] = useState(session?.frequency ?? 'Weekly')
  const [payerId, setPayerId] = useState(session?.payerId ?? available[0]?.id ?? '')
  const [attendees, setAttendees] = useState(session?.attendeeIds ?? available.map(member => member.id))
  const [active, setActive] = useState(session?.active ?? true)
  return <RecordForm submit={() => save({ id: session?.id ?? crypto.randomUUID(), groupId: group.id, name, amount: parseUnits(amount, minorDigits(group.currency)), startDate, frequency, payerId, attendeeIds: attendees, active })}>
    <Field label="Session name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Wednesday tennis" /></Field>
    <div className="form-grid">
      <Field label={`Court fee (${group.currency})`}><input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
      <Field label="First session"><input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></Field>
    </div>
    <div className="form-grid">
      <Field label="Repeats"><select value={frequency} onChange={event => setFrequency(event.target.value as SportsSession['frequency'])}>
        {frequencies.map(value => <option key={value}>{value}</option>)}
      </select></Field>
      <Field label="Usual payer"><select required value={payerId} onChange={event => setPayerId(event.target.value)}>
        <option value="">Select a member</option>{available.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}
      </select></Field>
    </div>
    <fieldset className="choice-group"><legend>Usual attendees</legend>
      {available.map(member => <label className="check-line" key={member.id}>
        <input type="checkbox" checked={attendees.includes(member.id)} onChange={event => setAttendees(event.target.checked
          ? [...attendees, member.id] : attendees.filter(id => id !== member.id))} />{member.name}
      </label>)}
    </fieldset>
    {session && <label className="check-line"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Schedule is active</label>}
  </RecordForm>
}

export function SessionsList({ sessions, expenses, currency, edit, record, create }: {
  sessions: SportsSession[]; expenses: Expense[]; currency: string;
  edit?: (session: SportsSession) => void; record?: (session: SportsSession, date: string) => void; create?: () => void;
}) {
  return <div className="form-stack">
    {sessions.length === 0 && <p className="muted">No recurring sports sessions for this group yet.</p>}
    {sessions.map(session => {
      const date = nextSessionDate(session, expenses)
      return <section className="session-item" key={session.id}>
        <h3>{session.name}</h3>
        <p>{session.frequency} · {money(session.amount, currency)}{!session.active ? ' · Paused' : date ? ` · Next ${formatDay(date, true)}` : ' · Schedule complete'}</p>
        {edit && <div className="inline-actions">
          <button className="button button-small" onClick={() => edit(session)}>Edit schedule</button>
          {session.active && date && record && <button className="button primary button-small" onClick={() => record(session, date)}>Record session</button>}
        </div>}
      </section>
    })}
    {create && <button className="button" onClick={create}><Plus size={17} />New schedule</button>}
  </div>
}

export function groupCurrencyLocked(data: AppData, groupId: string) {
  return [data.expenses, data.payments, data.sessions].some(records => records.some(record => record.groupId === groupId))
}
