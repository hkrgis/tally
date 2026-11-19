import { describe, expect, it } from 'vitest'
import { launchScreen, routeFrom, urlFor } from './routing'

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
})
