import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, CarFront, ChevronDown, CircleHelp, Clapperboard, Coffee, House, Luggage, Plus, ReceiptText, ShoppingBasket, X, type LucideIcon } from 'lucide-react'
import { categories, type Member } from './model'
import { firstName } from './people'

const categoryIcons: Record<typeof categories[number], [LucideIcon, string]> = {
  'Food & drink': [Coffee, 'peach'],
  Groceries: [ShoppingBasket, 'green'],
  Transport: [CarFront, 'blue'],
  Home: [House, 'lavender'],
  Sports: [CalendarDays, 'green'],
  Entertainment: [Clapperboard, 'lavender'],
  Travel: [Luggage, 'blue'],
  Other: [ReceiptText, 'neutral'],
}

export function CategoryIcon({ category }: { category: typeof categories[number] }) {
  const [Icon, tone] = categoryIcons[category]
  return <span className={`tile tone-${tone}`} aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></span>
}

export const PaymentIcon = () => <span className="tile tone-blue" aria-hidden="true"><ArrowLeftRight size={20} strokeWidth={1.8} /></span>
export const OwesIcon = () => <ArrowUpRight size={17} aria-hidden="true" />
export const OwedIcon = () => <ArrowDownLeft size={17} aria-hidden="true" />

const tones = ['lavender', 'peach', 'green', 'blue', 'neutral']
export const nameInitial = (name: string) => (Array.from(firstName(name))[0] ?? '').toUpperCase()

export function MemberSelect({ members, nameOf, value, ownMember, select, addSelf }: {
  members: Member[]; nameOf: (id: string) => string; value: string; ownMember: string; select: (id: string) => void; addSelf?: () => void;
}) {
  return <div className="inline-actions member-select">
    {members.length > 0 && <label className="identity">
      <span>View as</span>
      <select aria-label="Viewing as" value={value} onChange={event => select(event.target.value)}>
        {!value && <option value="" disabled>Choose member</option>}
        {members.map(member => <option value={member.id} key={member.id}>
          {nameOf(member.id)}{member.id === ownMember ? ' (you)' : ''}{member.active ? '' : ' (inactive)'}
        </option>)}
      </select>
    </label>}
    {addSelf && <button className="text-button" onClick={addSelf}>Add myself</button>}
  </div>
}

export function MemberRoster({ members, nameOf, edit, addSelf }: {
  members: Member[]; nameOf: (id: string) => string; edit?: (member?: Member) => void; addSelf?: () => void;
}) {
  return <div className="form-stack">
    {edit && <div className="inline-actions">
      <button className="button primary" onClick={() => edit()}><Plus size={17} />Add member</button>
      {addSelf && <button className="text-button" onClick={addSelf}>Add myself</button>}
    </div>}
    {members.length ? <ul className="roster-list">{members.map((member, index) => <li className="roster-row" key={member.id}>
      <Avatar member={member} index={index} />
      <span><strong>{nameOf(member.id)}</strong>{!member.active && <small>Inactive</small>}</span>
      {edit && <button className="text-button" aria-label={`Edit ${nameOf(member.id)}`} onClick={() => edit(member)}>Edit</button>}
    </li>)}</ul> : <p className="muted">No members yet.</p>}
  </div>
}

export function Avatar({ member, index = 0 }: { member: Member; index?: number }) {
  return <span className={`avatar tone-${tones[index % tones.length]}`} title={firstName(member.name)} aria-hidden="true">
    {member.avatar?.kind === 'photo' ? <img src={member.avatar.source} alt="" /> : member.avatar?.kind === 'emoji' ? member.avatar.value : nameInitial(member.name)}
  </span>
}

export const formatDay = (day: string, year = false) => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
}).format(new Date(`${day}T00:00:00Z`))

export const formatEventTime = (at: string) => new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(at))

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <section className="empty">
    <h2>{title}</h2>
    {children && <div>{children}</div>}
  </section>
}

export function Explanation({ title, children }: { title: string; children: ReactNode }) {
  return <details className="explanation">
    <summary><CircleHelp size={17} aria-hidden="true" />{title}<ChevronDown className="chevron" size={16} aria-hidden="true" /></summary>
    <div>{children}</div>
  </details>
}

export function Sheet({ title, description, children, close, busy, backLabel }: {
  title: string; description?: string; children: ReactNode; close: () => void; busy?: boolean; backLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const heading = useId()
  const caption = useId()
  useLayoutEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    if (backLabel) {
      dialog.current?.scrollTo(0, 0)
      back.current?.focus({ preventScroll: true })
    }
  }, [backLabel])
  return <dialog
    ref={dialog} className="sheet" aria-labelledby={heading} aria-describedby={description ? caption : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) close() }}
    onClick={event => { if (event.target === event.currentTarget && !busy) close() }}
  >
    <div className="sheet-inner">
      {backLabel && <button className="text-button sheet-back" ref={back} type="button" disabled={busy} onClick={close}>
        <ArrowLeft size={16} aria-hidden="true" />{backLabel}
      </button>}
      <header className="sheet-head">
        <div><h2 id={heading}>{title}</h2>{description && <p id={caption}>{description}</p>}</div>
        {!backLabel && <button className="icon-button" type="button" aria-label="Close dialog" disabled={busy} onClick={close}><X size={20} /></button>}
      </header>
      {children}
    </div>
  </dialog>
}
