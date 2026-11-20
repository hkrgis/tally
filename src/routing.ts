const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

export const groupViews = ['overview', 'expenses', 'calendar', 'balances', 'people', 'activity'] as const
export type GroupView = typeof groupViews[number]
export const primaryView = (view: GroupView) => view === 'calendar' ? 'expenses' : view === 'activity' ? 'overview' : view

export type Route = { page: 'groups' } | { page: 'admin' } | { page: 'group'; id: string; token: string; archived: boolean; view: GroupView; focus?: string }

export function routeFrom(url: URL): Route {
  const group = url.searchParams.get('group')
  if (group) {
    const hash = url.hash.slice(1)
    const token = /^invite=([a-f0-9]{64})$/.exec(hash)?.[1] ?? ''
    const id = uuid.test(group) ? 'f-' + group.toLowerCase() : group
    const view = hash === 'members' ? 'people' : groupViews.find(item => item === hash) ?? 'overview'
    const focus = token ? null : url.searchParams.get('record')
    return { page: 'group', id, token, archived: url.searchParams.get('admin') === 'archived', view,
      ...(focus && focus.length <= 210 ? { focus } : {}) }
  }
  return { page: url.hash === '#admin' ? 'admin' : 'groups' }
}

export function urlFor(route: Route, base: URL) {
  const url = new URL(base.pathname, base)
  if (route.page === 'admin') url.hash = 'admin'
  if (route.page === 'group') {
    url.searchParams.set('group', route.id)
    if (route.archived) url.searchParams.set('admin', 'archived')
    if (route.focus && !route.token) url.searchParams.set('record', route.focus)
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

// Map pre-Firebase links to the same ID used by the encrypted snapshot importer.
export async function firebaseGroupId(id: string) {
  if (id.startsWith("f-") && uuid.test(id.slice(2))) return id.toLowerCase()
  if (uuid.test(id)) return "f-" + id.toLowerCase()
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id))
  const hex = Array.from(new Uint8Array(digest, 0, 16), byte => byte.toString(16).padStart(2, "0")).join("")
  return "f-" + [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-")
}
