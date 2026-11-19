import { useEffect, useState } from 'react'
import { Archive, ChevronRight, Plus, RotateCcw, UsersRound } from 'lucide-react'
import { accountError, listAccountGroups, listPlatformGroups, type AccountGroup, type GroupHead } from './firebase'
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

export function MyGroups({ load, version, create, join, open }: {
  load: () => ReturnType<typeof listAccountGroups>; version: number;
  create: () => void; join: () => void; open: (id: string) => void;
}) {
  const { data, error, retry } = useDirectory<AccountGroup>(load, version)
  const sections = [
    { id: 'owned', label: 'Owned by Me', empty: 'Create a group to start sharing expenses.' },
    { id: 'joined', label: 'Groups I’ve Joined', empty: 'Join using a link from a group organiser.' },
  ] as const
  return <section aria-labelledby="my-groups">
    <header className="directory-heading">
      <h1 id="my-groups">My Groups</h1>
      <div className="inline-actions">
        <button className="button primary" onClick={create}><Plus size={17} />Create Group</button>
        <button className="button" onClick={join}>Join Group</button>
      </div>
    </header>
    {!data ? <DirectoryStatus error={error} retry={retry} /> : sections.map(section => {
      const groups = data.filter(group => group.role === section.id)
      return <section className="directory-section" key={section.id} aria-labelledby={section.id}>
        <header className="section-heading"><h2 id={section.id}>{section.label} <span className="muted">({groups.length})</span></h2></header>
        {groups.length ? <ul className="list-surface directory-list">
          {groups.map(group => {
            const summary = group.summary
            const net = group.balance
            const activity = group.restoredAt && group.restoredAt > (summary?.lastActivityAt ?? '') ? group.restoredAt : summary?.lastActivityAt
            return <li key={group.id}>
              <button className="group-list-row" onClick={() => open(group.id)}>
                <span className="tile tone-neutral" aria-hidden="true"><UsersRound size={19} /></span>
                <span className="group-list-text"><strong>{group.name}</strong>
                  <small>{summary ? `${summary.memberCount} ${summary.memberCount === 1 ? 'member' : 'members'}` : 'Member count available after opening'}
                    {summary?.lastActivityAt && <> · Last activity {formatEventTime(summary.lastActivityAt)}</>}</small>
                </span>
                <span className={net ? net < 0 ? 'negative' : 'positive' : 'muted'}>
                  {summary && typeof net === 'number' ? balanceLabel(net, summary.currency) : 'Balance unavailable'}
                </span>
                <ChevronRight size={16} className="chevron" aria-hidden="true" />
              </button>
            </li>
          })}
        </ul> : <Empty title={section.id === 'owned' ? 'No groups owned yet' : 'No joined groups yet'}>{section.empty}</Empty>}
      </section>
    })}
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
