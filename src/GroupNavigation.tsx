
import { ArrowLeftRight, House, ReceiptText, UsersRound } from 'lucide-react'
import { primaryView, type GroupView } from './routing'

const destinations = [
  { id: 'overview', label: 'Home', Icon: House },
  { id: 'expenses', label: 'Expenses', Icon: ReceiptText },
  { id: 'balances', label: 'Balances', Icon: ArrowLeftRight },
  { id: 'people', label: 'People', Icon: UsersRound },
] as const

export function GroupNavigation({ view, go, href }: {
  view: GroupView; go: (view: GroupView) => void; href?: (view: GroupView) => string;
}) {
  return <nav className="group-navigation" aria-label="Group navigation">
    {destinations.map(({ id, label, Icon }) => {
      const current = primaryView(view) === id ? 'page' : undefined
      const content = <><Icon size={18} aria-hidden="true" /><span>{label}</span></>
      return href ? <a key={id} href={href(id)} aria-current={current} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        go(id)
      }}>{content}</a> : <button key={id} type="button" aria-current={current} onClick={() => go(id)}>{content}</button>
    })}
  </nav>
}
