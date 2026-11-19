import { useCallback, useEffect, useState } from 'react'
import { Archive, ChevronRight, Plus, RotateCcw, UsersRound } from 'lucide-react'
import { accountError, listAccountGroups, listPlatformGroups, type GroupHead } from './firebase'
import { balanceLabel } from './money'
import { Empty, formatEventTime } from './ui'

function useDirectory<T>(load: () => Promise<T[]>, version: number) {
  const [data, setData] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let mounted = true
    setData(null)
    setError('')
    void load().then(value => { if (mounted) setData(value) }).catch(issue => { if (mounted) setError(accountError(issue)) })
    return () => { mounted = false }
  }, [load, version, attempt])
  return { data, error, retry: () => setAttempt(current => current + 1) }
}

function DirectoryStatus({ error, retry }: { error: string; retry: () => void }) {
  return error ? <div className="form-stack">
    <p className="notice danger" role="alert">{error}</p>
    <button className="text-button" onClick={retry}>Try again</button>
  </div> : <p className="loading" role="status">Loading groups…</p>
}

const groupSections = [
  { role: 'owned', label: 'Owned by Me', empty: 'No groups owned yet', hint: 'Create a group to start sharing expenses.' },
  { role: 'joined', label: 'Groups I?ve Joined', empty: 'No joined groups yet', hint: 'Join using a link from a group organiser.' },
] as const

function GroupSection({ accountId, section, version, open }: {
  accountId: string; section: typeof groupSections[number]; version: number; open: (id: string) => void;
}) {
  const { role, label, empty, hint } = section
  const load = useCallback(() => listAccountGroups(accountId, role), [accountId, role])
  const { data, error, retry } = useDirectory(load, version)
  const titleId = `${role}-groups`
  return <section className="directory-section" aria-labelledby={titleId}>
    <header className="section-heading">
      <h2 id={titleId}>{label}{data && <span className="muted"> ({data.length})</span>}</h2>
    </header>
    {!data ? <DirectoryStatus error={error} retry={retry} /> : data.length ? <ul className="list-surface directory-list">
      {data.map(group => {
        const summary = group.summary
        const net = group.balance
        const activity = group.restoredAt && group.restoredAt > (summary?.lastActivityAt ?? '') ? group.restoredAt : summary?.lastActivityAt
        return <li key={group.id}>
          <button className="group-list-row" onClick={() => open(group.id)}>
            <span className="tile tone-neutral" aria-hidden="true"><UsersRound size={19} /></span>
            <span className="group-list-text"><strong>{group.name}</strong>
              <small>{summary ? `${summary.memberCount} ${summary.memberCount === 1 ? 'member' : 'members'}` : 'Member count available after opening'}
                {activity && <> ? Last activity {formatEventTime(activity)}</>}</small>
            </span>
            <span className={net ? net < 0 ? 'negative' : 'positive' : 'muted'}>
              {summary && typeof net === 'number' ? balanceLabel(net, summary.currency) : 'Balance unavailable'}
            </span>
            <ChevronRight size={16} className="chevron" aria-hidden="true" />
          </button>
        </li>
      })}
    </ul> : <Empty title={empty}>{hint}</Empty>}
  </section>
}

export function MyGroups({ accountId, version, create, join, open }: {
  accountId: string; version: number;
  create: () => void; join: () => void; open: (id: string) => void;
}) {
  return <section aria-labelledby="my-groups">
    <header className="directory-heading">
      <h1 id="my-groups">My Groups</h1>
      <div className="inline-actions">
        <button className="button primary" onClick={create}><Plus size={17} />Create Group</button>
        <button className="button" onClick={join}>Join Group</button>
      </div>
    </header>
    {groupSections.map(section => <GroupSection key={section.role} accountId={accountId}
      section={section} version={version} open={open} />)}
  </section>
}

export function PlatformGroups({ version, archive, open }: {
  version: number; archive: (group: GroupHead) => void; open: (id: string) => void;
}) {
  const { data, error, retry } = useDirectory(listPlatformGroups, version)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived'>('active')
  const groups = data?.filter(group => Boolean(group.archivedAt) === (filter === 'archived') &&
    [group.summary?.name ?? group.legacyName, group.owner, group.id].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => (a.summary?.name ?? a.legacyName ?? a.id).localeCompare(b.summary?.name ?? b.legacyName ?? b.id))
  return <section aria-labelledby="platform-heading">
    <header className="directory-heading"><h1 id="platform-heading">Platform Admin</h1></header>
    <div className="filters">
      <label className="search-field"><input type="search" aria-label="Search groups" placeholder="Search groups or owner UID"
        value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="directory-segments auth-segments" role="group" aria-label="Group status">
        <button type="button" aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
          Active {data ? `(${data.filter(group => !group.archivedAt).length})` : ''}
        </button>
        <button type="button" aria-pressed={filter === 'archived'} onClick={() => setFilter('archived')}>
          Archived {data ? `(${data.filter(group => group.archivedAt).length})` : ''}
        </button>
      </div>
    </div>
    {!groups ? <DirectoryStatus error={error} retry={retry} /> : groups.length ? <ul className="list-surface admin-list">
      {groups.map(group => {
        const created = group.summary?.createdOn ?? group.createdAt
        return <li key={group.id}>
          <div className="admin-record">
            <strong>{group.summary?.name ?? group.legacyName ?? `Group ${group.id.slice(-8)}`}</strong>
            <dl>
              <div><dt>Owner UID</dt><dd>{group.owner}</dd></div>
              <div><dt>Members</dt><dd>{group.summary?.memberCount ?? 'Unavailable'}</dd></div>
              <div><dt>Created</dt><dd>{created ? formatEventTime(created) : 'Unavailable'}</dd></div>
              {group.archivedAt && <div><dt>Archived</dt><dd>{formatEventTime(group.archivedAt)}</dd></div>}
            </dl>
          </div>
          <div className="inline-actions">
            {group.archivedAt && <button className="text-button" onClick={() => open(group.id)}>Open archived group</button>}
            <button className="text-button" onClick={() => archive(group)}>
              {group.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}
              {group.archivedAt ? 'Restore' : 'Archive'}
            </button>
          </div>
        </li>
      })}
    </ul> : <Empty title={query.trim() ? 'No matching groups' : `No ${filter} groups`} />}
  </section>
}
