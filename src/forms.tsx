import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Camera, Plus, Trash2, X } from 'lucide-react'
import { categories, currencies, frequencies, groupPaymentMethods, isProfileEmoji, maxExpensePhotos, nextSessionDate, splitMethods, today, type AppData, type Expense, type ExpensePhoto, type Group, type Member, type MemberAvatar, type Payment, type SportsSession } from './model'
import { calculateBalances, decimal, minorDigits, money, parseUnits, type PairBalance } from './money'
import { methodLabels } from './screens'
import { Avatar, formatDay } from './ui'
import { errorText } from './useLedger'
import { photoTypes, preparePhoto, prepareProfilePhoto } from './photos'
import { maxPasswordLength, minPasswordLength } from './vault'

type Field = { label: string; children: ReactNode }
function Field({ label, children }: Field) {
  return <label className="field"><span>{label}</span>{children}</label>
}

type EditAction = () => void | Promise<void>

function RecordForm({ children, submit, submitLabel = 'Apply changes', remove, blocked }: {
  children: ReactNode; submit: EditAction; submitLabel?: string; remove?: EditAction; blocked?: boolean;
}) {
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  async function run(action: EditAction) {
    if (busy) return
    setBusy(true)
    setError('')
    try { await action() } catch (issue) { setError(errorText(issue)) }
    finally { setBusy(false) }
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!confirm && !blocked) void run(submit)
  }
  return <form className="form-stack" onSubmit={onSubmit}>
    <fieldset className="form-stack" disabled={busy}>{children}</fieldset>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {confirm && <div className="notice danger">
      <p>Remove this record from the draft and add a correction to Activity?</p>
      <div className="inline-actions">
        <button type="button" className="button danger-button" disabled={busy} onClick={() => remove && void run(remove)}>Remove record</button>
        <button type="button" className="button" disabled={busy} onClick={() => setConfirm(false)}>Keep record</button>
      </div>
    </div>}
    <footer className="form-footer">
      {remove && !confirm && <button type="button" className="text-button negative" disabled={busy || blocked} onClick={() => setConfirm(true)}><Trash2 size={16} />Remove</button>}
      <button className="button primary" type="submit" disabled={busy || confirm || blocked}>{busy ? 'Saving…' : submitLabel}</button>
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

function PaymentMethodField({ group, value, setValue }: { group: Group; value: string; setValue: (value: string) => void }) {
  const [adding, setAdding] = useState(false)
  return <>
    <Field label="Payment method"><select value={adding ? 'add' : `method:${value}`} onChange={event => {
      const next = event.target.value
      setAdding(next === 'add')
      setValue(next === 'add' ? '' : next.slice(7))
    }}>
      <option value="method:">Unspecified</option>
      {groupPaymentMethods(group).map(method => <option value={`method:${method}`} key={method}>{method}</option>)}
      <option value="add">Add a method…</option>
    </select></Field>
    {adding && <Field label="New payment method"><input required value={value} maxLength={30} pattern=".*\S.*"
      placeholder="e.g. Bank transfer" onChange={event => setValue(event.target.value)} /></Field>}
  </>
}

export function ExpenseForm({ group, members, memberId, expense, session, occurrenceDate, save, remove }: RecordContext & {
  memberId: string; expense?: Expense; session?: SportsSession; occurrenceDate?: string;
  save: (expense: Expense) => void | Promise<void>; remove?: EditAction;
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
  const [paymentMethod, setPaymentMethod] = useState(expense?.paymentMethod ?? '')
  const [photos, setPhotos] = useState<ExpensePhoto[]>(expense?.photos ?? [])
  const [preparing, setPreparing] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
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
  const participantCount = Object.keys(participants).length
  const splitLabel = method === 'percentage' ? 'Percentage' : method === 'exact' ? 'Share amount' : 'Weight'
  const initialShare = method === 'weighted' || method === 'equal' ? '1' : ''

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
    return save({ id: expense?.id ?? crypto.randomUUID(), groupId: group.id, description, amount: total, date, category, notes,
      photos: photos.length ? photos : undefined, paymentMethod: paymentMethod.trim() || undefined,
      payers: expensesPayers, split: { method, participants: shares }, sessionId: expense?.sessionId ?? session?.id })
  }
  async function attach(files: File[]) {
    if (!files.length) return
    setPhotoError('')
    if (photos.length + files.length > maxExpensePhotos) {
      setPhotoError(`Choose up to ${maxExpensePhotos} photos per expense.`)
      return
    }
    setPreparing(true)
    try {
      const additions: ExpensePhoto[] = []
      for (const file of files) additions.push(await preparePhoto(file))
      setPhotos(current => [...current, ...additions])
    } catch (issue) { setPhotoError(errorText(issue)) }
    finally { setPreparing(false) }
  }
  return <RecordForm submit={submit} remove={remove} blocked={preparing}>
    <Field label="Description"><input required maxLength={100} value={description} onChange={event => setDescription(event.target.value)} placeholder="e.g. Dinner for four" /></Field>
    <div className="form-grid">
      <Field label={`Total (${group.currency})`}><input inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder={amountPlaceholder} /></Field>
      <Field label="Date"><input type="date" required min={session && !expense ? session.startDate : undefined} value={date} onChange={event => setDate(event.target.value)} /></Field>
    </div>
    <Field label="Category"><select value={category} onChange={event => setCategory(event.target.value as Expense['category'])}>
      {categories.map(value => <option key={value}>{value}</option>)}
    </select></Field>
    <PaymentMethodField group={group} value={paymentMethod} setValue={setPaymentMethod} />
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
      {available.length > 1 && <div className="choice-toolbar">
        <small>{participantCount} of {available.length} selected</small>
        <div className="inline-actions">
          <button type="button" className="text-button" disabled={participantCount === available.length} onClick={() => {
            setParticipants(Object.fromEntries(available.map(member => [member.id, selected(participants, member.id) ? participants[member.id] : initialShare])))
          }}>Select all</button>
          <button type="button" className="text-button" disabled={!participantCount} onClick={() => setParticipants({})}>Clear all</button>
        </div>
      </div>}
      {available.map(member => <div className="choice-row" key={member.id}>
        <label><input type="checkbox" checked={selected(participants, member.id)}
          onChange={event => setParticipants(choose(participants, member.id, event.target.checked, initialShare))} />
          {member.name}{!member.active && ' (inactive)'}</label>
        {selected(participants, member.id) && method !== 'equal' && <input required inputMode={method === 'weighted' ? 'numeric' : 'decimal'}
          aria-label={`${splitLabel} for ${member.name}`} value={participants[member.id]}
          onChange={event => setParticipants({ ...participants, [member.id]: event.target.value })} />}
      </div>)}
    </fieldset>
    <Field label="Notes (optional)"><textarea rows={3} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Add context, receipt details or a reminder" /></Field>
    <fieldset className="choice-group attachment-field">
      <legend>Photos and receipts</legend>
      {photos.length > 0 && <ul className="photo-previews">{photos.map(photo => <li key={photo.id}>
        <img src={photo.source} alt={photo.name} />
        <span title={photo.name}>{photo.name}</span>
        <button className="icon-button" type="button" disabled={preparing} aria-label={`Remove ${photo.name}`} onClick={() => setPhotos(current => current.filter(item => item.id !== photo.id))}><X size={16} /></button>
      </li>)}</ul>}
      <input ref={picker} type="file" hidden aria-label="Choose expense photos" accept={photoTypes.join(',')} multiple onChange={event => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        void attach(files)
      }} />
      <button className="button button-small" type="button" onClick={() => picker.current?.click()} disabled={preparing || photos.length >= maxExpensePhotos}>
        <Camera size={17} />{preparing ? 'Preparing photos…' : 'Attach photos'}
      </button>
      <p>Up to {maxExpensePhotos} JPEG, PNG or WebP images. Tally resizes photos before saving.</p>
      {photoError && <p className="notice danger" role="alert">{photoError}</p>}
    </fieldset>
  </RecordForm>
}

export function PaymentForm({ group, members, expenses, payments, pair, payment, save, remove }: RecordContext & {
  expenses: Expense[]; payments: Payment[]; pair?: PairBalance; payment?: Payment;
  save: (payment: Payment) => void | Promise<void>; remove?: EditAction;
}) {
  const [from, setFrom] = useState(payment?.from ?? pair?.from ?? '')
  const [to, setTo] = useState(payment?.to ?? pair?.to ?? '')
  const [date, setDate] = useState(payment?.date ?? today())
  const [notes, setNotes] = useState(payment?.notes ?? '')
  const [paymentMethod, setPaymentMethod] = useState(payment?.paymentMethod ?? '')
  const [amount, setAmount] = useState(payment ? decimal(payment.amount, group.currency) : pair ? decimal(pair.outstanding, group.currency) : '')
  const pairs = calculateBalances(expenses, payments.filter(value => value.id !== payment?.id))
  const outstanding = pairs.find(value => value.from === from && value.to === to)?.outstanding ?? 0
  const ceiling = Math.max(outstanding, payment?.from === from && payment?.to === to ? payment.amount : 0)
  function submit() {
    const total = parseUnits(amount, minorDigits(group.currency))
    if (!from || !to || from === to) throw new Error('Select different members for the payer and recipient.')
    if (!total || total > ceiling) throw new Error(`Enter a payment greater than zero and up to ${money(ceiling, group.currency)}.`)
    return save({ id: payment?.id ?? crypto.randomUUID(), groupId: group.id, from, to, amount: total, date, notes,
      paymentMethod: paymentMethod.trim() || undefined })
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
    <PaymentMethodField group={group} value={paymentMethod} setValue={setPaymentMethod} />
    <Field label="Notes (optional)"><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
  </RecordForm>
}

export function GroupForm({ group, currencyLocked, save }: { group?: Group; currencyLocked?: boolean; save: (group: Group, password: string) => Promise<void> }) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [currency, setCurrency] = useState(group?.currency ?? 'AUD')
  const [archived, setArchived] = useState(group?.archived ?? false)
  const [rotate, setRotate] = useState(false)
  const password = useRef<HTMLInputElement>(null)
  const confirmPassword = useRef<HTMLInputElement>(null)
  const names = new Intl.DisplayNames('en-AU', { type: 'currency' })
  return <RecordForm submit={() => {
    const access = password.current?.value ?? ''
    if (access !== (confirmPassword.current?.value ?? '')) throw new Error('The passwords do not match.')
    return save({ ...group, id: group?.id ?? crypto.randomUUID(), name, description, currency, archived }, access)
  }}>
    <Field label="Group name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="Description (optional)"><textarea rows={2} maxLength={240} value={description} onChange={event => setDescription(event.target.value)} /></Field>
    <Field label="Currency"><select disabled={currencyLocked} value={currency} onChange={event => setCurrency(event.target.value)}>
      {currencies.map(value => <option key={value} value={value}>{value} · {names.of(value)}</option>)}
    </select></Field>
    {currencyLocked && <p className="muted">This group’s records use {currency}.</p>}
    {group && <label className="check-line"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Archive group</label>}
    {group && <label className="check-line"><input type="checkbox" checked={rotate} onChange={event => setRotate(event.target.checked)} />Change group password</label>}
    {(!group || rotate) && <>
      <Field label="Group password"><input ref={password} type="password" autoComplete="new-password" minLength={minPasswordLength} maxLength={maxPasswordLength} required /></Field>
      <Field label="Confirm group password"><input ref={confirmPassword} type="password" autoComplete="new-password" maxLength={maxPasswordLength} required /></Field>
      <p className="muted">Use a unique password of at least {minPasswordLength} characters. Save it somewhere safe and share it with your group. Tally cannot recover it.</p>
      {rotate && <p className="muted">Previous snapshots can still be opened with their original password.</p>}
    </>}
  </RecordForm>
}

export function MemberForm({ group, member, save }: { group: Group; member?: Member; save: (member: Member) => void | Promise<void> }) {
  const [name, setName] = useState(member?.name ?? '')
  const [active, setActive] = useState(member?.active ?? true)
  const [avatar, setAvatar] = useState<MemberAvatar | undefined>(member?.avatar)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const photo = useRef<HTMLInputElement>(null)
  const id = member?.id ?? ''
  const candidate = { id, groupId: group.id, name: name.trim() || 'Member', active, avatar }
  async function attach(file: File) {
    setPreparing(true)
    setError('')
    try { setAvatar(await prepareProfilePhoto(file)) } catch (issue) { setError(errorText(issue)) }
    finally { setPreparing(false) }
  }
  return <RecordForm blocked={preparing} submit={() => {
    if (avatar?.kind === 'emoji' && !isProfileEmoji(avatar.value)) throw new Error('Enter one emoji.')
    return save({ ...candidate, id: member?.id ?? crypto.randomUUID(), name })
  }}>
    <Field label="Name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
    <fieldset className="choice-group profile-field">
      <legend>Profile picture</legend>
      <div className="profile-preview">
        <Avatar member={candidate} />
        <div className="inline-actions">
          <button type="button" className="button button-small" onClick={() => photo.current?.click()} disabled={preparing}>
            <Camera size={16} />{preparing ? 'Preparing…' : 'Upload photo'}
          </button>
          {avatar && <button type="button" className="text-button" disabled={preparing} onClick={() => { setAvatar(undefined); setError('') }}>Use initials</button>}
        </div>
      </div>
      <input ref={photo} type="file" hidden accept={photoTypes.join(',')} aria-label="Choose profile photo" onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void attach(file)
      }} />
      <Field label="Or use an emoji"><input maxLength={40} value={avatar?.kind === 'emoji' ? avatar.value : ''} placeholder="e.g. 🏓"
        disabled={preparing} onChange={event => setAvatar(event.target.value ? { kind: 'emoji', value: event.target.value.trim() } : undefined)} /></Field>
      {error && <p className="notice danger" role="alert">{error}</p>}
    </fieldset>
    {member && <label className="check-line"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Available for new expenses</label>}
  </RecordForm>
}

export function SessionForm({ group, members, session, save }: RecordContext & {
  session?: SportsSession; save: (session: SportsSession) => void | Promise<void>;
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
