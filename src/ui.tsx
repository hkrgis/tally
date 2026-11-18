import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, CarFront, ChevronDown, CircleHelp, Clapperboard, Coffee, House, Luggage, ReceiptText, ShoppingBasket, X, type LucideIcon } from 'lucide-react'
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
export function Avatar({ member, index = 0 }: { member: Member; index?: number }) {
  const initials = member.name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()
  return <span className={`avatar tone-${tones[index % tones.length]}`} title={member.name} aria-hidden="true">
    {member.avatar?.kind === 'photo' ? <img src={member.avatar.source} alt="" /> : member.avatar?.kind === 'emoji' ? member.avatar.value : initials}
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
    <span className="tile tone-lavender" aria-hidden="true"><ReceiptText size={20} /></span>
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

export function Sheet({ title, description, children, close, busy }: {
  title: string; description?: string; children: ReactNode; close: () => void; busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
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
  return <dialog
    ref={dialog} className="sheet" aria-labelledby={heading} aria-describedby={description ? caption : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) close() }}
    onClick={event => { if (event.target === event.currentTarget && !busy) close() }}
  >
    <div className="sheet-inner">
      <header className="sheet-head">
        <div><h2 id={heading}>{title}</h2>{description && <p id={caption}>{description}</p>}</div>
        <button className="icon-button" type="button" aria-label="Close dialog" disabled={busy} onClick={close}><X size={20} /></button>
      </header>
      {children}
    </div>
  </dialog>
}
