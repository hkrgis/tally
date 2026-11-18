import { describe, expect, it } from 'vitest'
import { monthCells, offsetMonth } from './calendar'

describe('monthly expense calendar', () => {
  it('aligns weeks on Monday and includes leap days', () => {
    const cells = monthCells('2028-02')
    expect(cells).toHaveLength(35)
    expect(cells.slice(0, 2)).toEqual([null, '2028-02-01'])
    expect(cells.filter(Boolean)).toHaveLength(29)
    expect(cells[29]).toBe('2028-02-29')
  })
  it('moves correctly across December and January', () => {
    expect(offsetMonth('2026-12', 1)).toBe('2027-01')
    expect(offsetMonth('2026-01', -1)).toBe('2025-12')
    expect(monthCells('9999-12').filter(Boolean)).toHaveLength(31)
  })
})
