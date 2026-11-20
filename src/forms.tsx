import { useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { Camera, ChevronDown, Trash2, UsersRound, X } from 'lucide-react'
import { categories, currencies, groupPaymentMethods, isProfileEmoji, maxExpensePhotos, splitMethods, today, type AppData, type Expense, type ExpensePhoto, type Group, type Member, type MemberAvatar, type Payment } from './model'
import { calculateBalances, decimal, minorDigits, money, parseUnits, splitExpense, type PairBalance } from './money'
import { firstName } from './people'
import { methodLabels } from './screens'
import { Avatar } from './ui'
import { errorText } from './useLedger'
import { photoTypes, preparePhoto, prepareProfilePhoto } from './photos'

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
  const running = useRef(false)
  async function run(action: EditAction) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (issue) { setError(errorText(issue)) }
    finally { running.current = false; setBusy(false) }
  }
  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!confirm && !blocked) void run(submit)
  }
  return <form className="form-stack" onSubmit={onSubmit} onInvalid={event => {
    const details = (event.target as HTMLElement).closest("details")
    if (details) details.open = true
  }}>
    <fieldset className="form-stack" disabled={busy}>{children}</fieldset>
    {error && <p className="notice danger" role="alert">{error}</p>}
    {confirm && <div className="notice danger">
      <p>Remove this record and add a correction to Activity?</p>
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

type RecordContext = { group: Group; members: Member[]; nameOf: (id: string) => string }
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

const defaultPaymentMethod = 'PayID'

function PaymentMethodField({ group, value, setValue, bankTransfer }: { group: Group; value: string; setValue: (value: string) => void; bankTransfer?: boolean }) {
  const [adding, setAdding] = useState(false)
  const methods = groupPaymentMethods(group)
  if (bankTransfer && !methods.some(method => method.toLowerCase() === "bank transfer")) methods.push("Bank transfer")
  return <>
    <Field label="Payment method"><select aria-label="Payment method" value={adding ? 'add' : `method:${value}`} onChange={event => {
      const next = event.target.value
      setAdding(next === 'add')
      setValue(next === 'add' ? '' : next.slice(7))
    }}>
      <option value="method:">Unspecified</option>
      {methods.map(method => <option value={`method:${method}`} key={method}>{method}</option>)}
      <option value="add">Add a method…</option>
    </select></Field>
    {adding && <Field label="New payment method"><input required value={value} maxLength={30} pattern=".*\S.*"
      placeholder="e.g. Bank transfer" onChange={event => setValue(event.target.value)} /></Field>}
  </>
}

export function ExpenseForm({ group, members, nameOf, memberId, expense, occurrenceDate, save, remove, manageMembers, manageButton }: RecordContext & {
  memberId: string; expense?: Expense; occurrenceDate?: string;
  save: (expense: Expense) => void | Promise<void>; remove?: EditAction;
  manageMembers: () => void; manageButton: Ref<HTMLButtonElement>;
}) {
  const active = members.filter(member => member.active)
  const preferred = active.find(member => member.id === memberId)?.id
  const formatAmount = (value: number) => decimal(value, group.currency)
  const amountPlaceholder = formatAmount(0)
  const moneyDigits = minorDigits(group.currency)
  const [recordId] = useState(() => expense?.id ?? crypto.randomUUID())
  const [description, setDescription] = useState(expense?.description ?? '')
  const [amount, setAmount] = useState(expense ? formatAmount(expense.amount) : '')
  const [date, setDate] = useState(expense?.date ?? occurrenceDate ?? today())
  const [category, setCategory] = useState<Expense['category']>(expense?.category ?? 'Other')
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [paymentMethod, setPaymentMethod] = useState(expense ? expense.paymentMethod ?? '' : defaultPaymentMethod)
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
    Object.fromEntries(active.map(member => [member.id, '1'])))
  const available = members.filter(member => member.active || selected(payers, member.id) || selected(participants, member.id) ||
    expense?.payers.some(payer => payer.memberId === member.id) || expense?.split.participants.some(person => person.memberId === member.id))
  const payerCount = Object.keys(payers).length
  const participantCount = Object.keys(participants).length
  const splitLabel = method === 'percentage' ? 'Percentage' : method === 'exact' ? 'Share amount' : 'Weight'
  const initialShare = method === 'weighted' || method === 'equal' ? '1' : ''

  function draft(): Expense {
    const total = parseUnits(amount, moneyDigits)
    if (!total) throw new Error('Enter a total greater than zero.')
    if (!payerCount || !participantCount) throw new Error('Select at least one payer and participant.')
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
    return { id: recordId, groupId: group.id, description, amount: total, date, category, notes,
      photos: photos.length ? photos : undefined, paymentMethod: paymentMethod.trim() || undefined,
      payers: expensesPayers, split: { method, participants: shares }, sessionId: expense?.sessionId }
  }
  let preview: ReturnType<typeof splitExpense> = []
  try { preview = splitExpense(draft()) } catch { /* The form can still be incomplete. */ }

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
  const quickPayer = payerCount === 1 ? Object.keys(payers)[0] : payerCount > 1 ? "multiple" : ""
  return <RecordForm submit={() => save(draft())} submitLabel={expense ? "Save changes" : "Save expense"} remove={remove} blocked={preparing}>
    <div className="expense-amount"><Field label={"Amount (" + group.currency + ")"}>
      <input autoFocus={!expense} inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} placeholder={amountPlaceholder} />
    </Field></div>
    <Field label="What was it for?"><input required maxLength={100} value={description} onChange={event => setDescription(event.target.value)} placeholder="e.g. Court hire" /></Field>
    <div className="form-grid">
      <Field label="Paid by"><select aria-label="Paid by" value={quickPayer} onChange={event => setPayers(event.target.value ? { [event.target.value]: amount } : {})}>
        <option value="">Select a payer</option>
        {payerCount > 1 && <option value="multiple" disabled>Multiple payers</option>}
        {available.map(member => <option value={member.id} key={member.id}>{nameOf(member.id)}{!member.active && " (inactive)"}</option>)}
      </select></Field>
      <Field label="Date"><input type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field>
    </div>
    <p className="muted">Split between {participantCount} {participantCount === 1 ? "person" : "people"} &middot; {methodLabels[method]}</p>
    {preview.length > 0 && <details className="share-preview"><summary>Preview shares</summary>
      <ul>{preview.map(share => <li className="line" key={share.memberId}><span>{nameOf(share.memberId)}</span><strong>{money(share.amount, group.currency)}</strong></li>)}</ul>
    </details>}
    <details className="more-expense">
      <summary>More options<ChevronDown className="chevron" size={17} aria-hidden="true" /></summary>
      <div className="form-stack">
        <Field label="Category"><select value={category} onChange={event => setCategory(event.target.value as Expense['category'])}>
          {categories.map(value => <option key={value}>{value}</option>)}
        </select></Field>
        <PaymentMethodField group={group} value={paymentMethod} setValue={setPaymentMethod} />
        <fieldset className="choice-group">
          <legend>Payer contributions</legend>
          {available.map(member => <div className="choice-row" key={member.id}>
            <label><input type="checkbox" checked={selected(payers, member.id)} onChange={event => setPayers(choose(payers, member.id, event.target.checked, payerCount ? '' : amount))} />{nameOf(member.id)}{!member.active && ' (inactive)'}</label>
            {selected(payers, member.id) && (payerCount === 1 ? <small>Full amount</small> :
              <input inputMode="decimal" aria-label={`Amount paid by ${nameOf(member.id)}`} required value={payers[member.id]} placeholder={amountPlaceholder} onChange={event => setPayers({ ...payers, [member.id]: event.target.value })} />)}
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
          <legend>Participants</legend>
          <div className="choice-toolbar">
            <button type="button" className="text-button" ref={manageButton} onClick={manageMembers}>
              <UsersRound size={16} aria-hidden="true" />Manage members
            </button>
            {available.length > 1 && <div className="inline-actions">
              <small>{participantCount} of {available.length} selected</small>
              <button type="button" className="text-button" disabled={participantCount === available.length} onClick={() => {
                setParticipants(Object.fromEntries(available.map(member => [member.id, selected(participants, member.id) ? participants[member.id] : initialShare])))
              }}>Select all</button>
              <button type="button" className="text-button" disabled={!participantCount} onClick={() => setParticipants({})}>Clear all</button>
            </div>}
          </div>
          {available.map(member => <div className="choice-row" key={member.id}>
            <label><input type="checkbox" checked={selected(participants, member.id)}
              onChange={event => setParticipants(choose(participants, member.id, event.target.checked, initialShare))} />
              {nameOf(member.id)}{!member.active && ' (inactive)'}</label>
            {selected(participants, member.id) && method !== 'equal' && <input required inputMode={method === 'weighted' ? 'numeric' : 'decimal'}
              aria-label={`${splitLabel} for ${nameOf(member.id)}`} value={participants[member.id]}
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
      </div>
    </details>
  </RecordForm>
}

export function PaymentForm({ group, members, nameOf, expenses, payments, pair, payment, save, remove }: RecordContext & {
  expenses: Expense[]; payments: Payment[]; pair?: PairBalance; payment?: Payment;
  save: (payment: Payment) => void | Promise<void>; remove?: EditAction;
}) {
  const [paymentId] = useState(() => payment?.id ?? crypto.randomUUID())
  const [review, setReview] = useState<Payment>()
  const [receipt, setReceipt] = useState(payment?.receipt)
  const [preparing, setPreparing] = useState(false)
  const [receiptError, setReceiptError] = useState("")
  const picker = useRef<HTMLInputElement>(null)
  const [from, setFrom] = useState(payment?.from ?? pair?.from ?? '')
  const [to, setTo] = useState(payment?.to ?? pair?.to ?? '')
  const [date, setDate] = useState(payment?.date ?? today())
  const [notes, setNotes] = useState(payment?.notes ?? '')
  const [paymentMethod, setPaymentMethod] = useState(payment ? payment.paymentMethod ?? '' : defaultPaymentMethod)
  const [amount, setAmount] = useState(payment ? decimal(payment.amount, group.currency) : pair ? decimal(pair.outstanding, group.currency) : '')
  const pairs = calculateBalances(expenses, payments.filter(value => value.id !== payment?.id))
  const outstanding = pairs.find(value => value.from === from && value.to === to)?.outstanding ?? 0
  const ceiling = Math.max(outstanding, payment?.from === from && payment?.to === to ? payment.amount : 0)
  function submit() {
    const total = parseUnits(amount, minorDigits(group.currency))
    if (!from || !to || from === to) throw new Error('Select different members for the payer and recipient.')
    if (!total || total > ceiling) throw new Error(`Enter a payment greater than zero and up to ${money(ceiling, group.currency)}.`)
    if (review) return save(review)
    setReview({ id: paymentId, groupId: group.id, from, to, amount: total, date, notes, receipt,
      paymentMethod: paymentMethod.trim() || undefined })
  }
  async function attach(file: File) {
    setPreparing(true)
    setReceiptError("")
    try { setReceipt(await preparePhoto(file)) } catch (issue) { setReceiptError(errorText(issue)) }
    finally { setPreparing(false) }
  }
  return <RecordForm submit={submit} submitLabel={review ? "Confirm payment" : "Review payment"}
    remove={review ? undefined : remove} blocked={preparing}>
    {review ? <div className="form-stack">
      <p className="notice"><strong>{nameOf(review.from)}</strong> paid <strong>{money(review.amount, group.currency)}</strong> to <strong>{nameOf(review.to)}</strong>.</p>
      <p className="muted">{review.date}{review.paymentMethod && " / " + review.paymentMethod}</p>
      <button className="text-button" type="button" onClick={() => setReview(undefined)}>Back to payment details</button>
    </div> : <>
    {pair ? <dl className="form-grid settlement-parties">
      <div><dt>Paid by</dt><dd>{nameOf(from)}</dd></div>
      <div><dt>Paid to</dt><dd>{nameOf(to)}</dd></div>
    </dl> : <div className="form-grid">
      <Field label="Paid by"><select required value={from} onChange={event => setFrom(event.target.value)}>
        <option value="">Select a member</option>{members.map(member => <option key={member.id} value={member.id}>{nameOf(member.id)}</option>)}
      </select></Field>
      <Field label="Paid to"><select required value={to} onChange={event => setTo(event.target.value)}>
        <option value="">Select a member</option>{members.filter(member => member.id !== from || member.id === to).map(member => <option key={member.id} value={member.id}>{nameOf(member.id)}</option>)}
      </select></Field>
    </div>}
    {from && to && from !== to && <p className="notice">{money(outstanding, group.currency)} outstanding before this payment.</p>}
    <div className="form-grid">
      <Field label={`Amount (${group.currency})`}><input required value={amount} inputMode="decimal" onChange={event => setAmount(event.target.value)} /></Field>
      <Field label="Date"><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
    </div>
    <PaymentMethodField bankTransfer group={group} value={paymentMethod} setValue={setPaymentMethod} />
    <Field label="Notes (optional)"><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
    <div className="file-field">
      {receipt && <div className="inline-actions"><p>{receipt.name}</p><button className="text-button" type="button" onClick={() => setReceipt(undefined)} aria-label="Remove receipt"><X size={17} />Remove</button></div>}
      <input ref={picker} hidden type="file" accept={photoTypes.join(",")} aria-label="Choose payment receipt" onChange={event => {
        const file = event.target.files?.[0]
        event.target.value = ""
        if (file) void attach(file)
      }} />
      <button type="button" className="button" disabled={preparing} onClick={() => picker.current?.click()}>
        <Camera size={17} />{preparing ? "Preparing receipt" : receipt ? "Replace receipt" : "Attach receipt"}
      </button>
      {receiptError && <p className="notice danger" role="alert">{receiptError}</p>}
    </div>
    </>}
  </RecordForm>
}

export function GroupForm({ group, currencyLocked, defaultOwnerName, save }: {
  group?: Group; currencyLocked?: boolean; defaultOwnerName?: string; save: (group: Group, ownerName?: string) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [ownerName, setOwnerName] = useState(defaultOwnerName?.slice(0, 100) ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [currency, setCurrency] = useState(group?.currency ?? 'AUD')
  const names = new Intl.DisplayNames('en-AU', { type: 'currency' })
  return <RecordForm submit={() => {
    const owner = firstName(ownerName)
    if (defaultOwnerName !== undefined && !owner) throw new Error('Enter your first name to join the group.')
    return save({ ...group, id: group?.id ?? crypto.randomUUID(), name, description, currency, archived: group?.archived ?? false }, owner || undefined)
  }}>
    <Field label="Group name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></Field>
    {defaultOwnerName !== undefined && <Field label="Your first name"><input required autoComplete="given-name" maxLength={100}
      value={ownerName} onChange={event => setOwnerName(event.target.value)} /></Field>}
    <Field label="Description (optional)"><textarea rows={2} maxLength={240} value={description} onChange={event => setDescription(event.target.value)} /></Field>
    <Field label="Currency"><select disabled={currencyLocked} value={currency} onChange={event => setCurrency(event.target.value)}>
      {currencies.map(value => <option key={value} value={value}>{value} · {names.of(value)}</option>)}
    </select></Field>
    {currencyLocked && <p className="muted">This group’s records use {currency}.</p>}
  </RecordForm>
}

export function MemberForm({ group, member, defaultName, canLink, save }: {
  group: Group; member?: Member; defaultName?: string; canLink?: boolean; save: (member: Member, link: boolean) => void | Promise<void>;
}) {
  const [name, setName] = useState(member?.name ?? defaultName ?? '')
  const [active, setActive] = useState(member?.active ?? true)
  const [link, setLink] = useState(false)
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
    return save({ ...candidate, id: member?.id ?? crypto.randomUUID(), name }, link)
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
    {canLink && <label className="check-line"><input type="checkbox" checked={link} onChange={event => setLink(event.target.checked)} />This is me</label>}
  </RecordForm>
}

export function groupCurrencyLocked(data: AppData, groupId: string) {
  return [data.expenses, data.payments].some(records => records.some(record => record.groupId === groupId))
}
