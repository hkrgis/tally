export const groupViews = ['overview', 'expenses', 'calendar', 'balances', 'activity'] as const
export type GroupView = typeof groupViews[number]

export type Route = { page: 'groups' } | { page: 'admin' } | { page: 'group'; id: string; token: string; archived: boolean; view: GroupView }

export function routeFrom(url: URL): Route {
  const group = url.searchParams.get('group')
  if (group) {
    const hash = url.hash.slice(1)
    const token = /^invite=([a-f0-9]{64})$/.exec(hash)?.[1] ?? ''
    const id = /^[a-f0-9-]{36}$/.test(group) ? `f-${group}` : group
    return { page: 'group', id, token, archived: url.searchParams.get('admin') === 'archived',
      view: groupViews.find(item => item === hash) ?? 'overview' }
  }
  return { page: url.hash === '#admin' ? 'admin' : 'groups' }
}

export function urlFor(route: Route, base: URL) {
  const url = new URL(base.pathname, base)
  if (route.page === 'admin') url.hash = 'admin'
  if (route.page === 'group') {
    url.searchParams.set('group', route.id)
    if (route.archived) url.searchParams.set('admin', 'archived')
    if (route.token) url.hash = `invite=${route.token}`
    else if (route.view !== 'overview') url.hash = route.view
  }
  return url
}

export function launchScreen(configured: boolean, loading: boolean, signedIn: boolean) {
  if (!configured) return 'setup'
  if (loading) return 'loading'
  return signedIn ? 'dashboard' : 'authentication'
}
