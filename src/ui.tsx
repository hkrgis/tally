import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, CarFront, ChevronDown, CircleHelp, Clapperboard, Coffee, House, Luggage, Plus, ReceiptText, ShoppingBasket, X, type LucideIcon } from 'lucide-react'
import { categories, type Member } from './model'

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
export const memberInitials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()

export function MemberRoster({ members, edit }: { members: Member[]; edit?: (member?: Member) => void }) {
  return <div className="form-stack">
    {edit && <button className="button primary" onClick={() => edit()}><Plus size={17} />Add member</button>}
    {members.length ? <ul className="roster-list">{members.map((member, index) => <li className="roster-row" key={member.id}>
      <Avatar member={member} index={index} />
      <span><strong>{member.name}</strong>{!member.active && <small>Inactive</small>}</span>
      {edit && <button className="text-button" aria-label={`Edit ${member.name}`} onClick={() => edit(member)}>Edit</button>}
    </li>)}</ul> : <p className="muted">No members yet.</p>}
  </div>
}

export function Avatar({ member, index = 0 }: { member: Member; index?: number }) {
  return <span className={`avatar tone-${tones[index % tones.length]}`} title={member.name} aria-hidden="true">
    {member.avatar?.kind === 'photo' ? <img src={member.avatar.source} alt="" /> : member.avatar?.kind === 'emoji' ? member.avatar.value : memberInitials(member.name)}
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
