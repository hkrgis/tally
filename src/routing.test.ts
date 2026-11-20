import { describe, expect, it } from 'vitest'
import { firebaseGroupId, launchScreen, primaryView, routeFrom, urlFor } from './routing'

describe('authentication routing', () => {
  it('uses the loading screen until Firebase resolves its session', () => {
    expect(launchScreen(true, true, false)).toBe('loading')
    expect(launchScreen(true, true, true)).toBe('loading')
    expect(launchScreen(true, false, false)).toBe('authentication')
    expect(launchScreen(true, false, true)).toBe('dashboard')
    expect(launchScreen(false, false, false)).toBe('setup')
  })

  it('round-trips invitations, group views and the admin route under a GitHub Pages subpath', () => {
    const id = 'f-3ce7a9ff-ffcb-407e-8126-a4019426112c'
    const token = 'a'.repeat(64)
    const base = new URL('https://example.com/tally/')
    const invite = { page: 'group', id, archived: false, view: 'overview', token } as const
    const archived = { ...invite, token: '', archived: true, view: 'balances' } as const
    expect(urlFor(invite, base).pathname).toBe('/tally/')
    expect(urlFor(invite, base).searchParams.has('invite')).toBe(false)
    expect(routeFrom(urlFor(invite, base))).toEqual(invite)
    expect(routeFrom(urlFor(archived, base))).toEqual(archived)
    expect(routeFrom(urlFor({ page: 'admin' }, base))).toEqual({ page: 'admin' })
    expect(routeFrom(new URL(`?group=${id.slice(2)}#expenses`, base))).toMatchObject({ id, view: 'expenses' })
  })
  it("preserves legacy group routes and round-trips a record drill-down", async () => {
    const base = new URL("https://example.com/tally/")
    const group = "book-club"
    for (const [hash, view] of [["overview", "overview"], ["home", "overview"], ["calendar", "calendar"], ["activity", "activity"], ["members", "people"]]) {
      expect(routeFrom(new URL("?group=" + group + "#" + hash, base))).toMatchObject({ id: group, view })
    }
    expect(primaryView("calendar")).toBe("expenses")
    expect(primaryView("activity")).toBe("overview")
    const id = await firebaseGroupId(group)
    expect(id).toBe("f-5f9aef2d-01cb-0e1a-3b20-cc22e4749076")
    expect(await firebaseGroupId(id)).toBe(id)
    const route = { page: "group", id, token: "", archived: false, view: "balances", focus: "roster-1:roster-2" } as const
    expect(routeFrom(urlFor(route, base))).toEqual(route)
  })
})
