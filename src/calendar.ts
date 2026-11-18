export function offsetMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999 ? month : date.toISOString().slice(0, 7)
}

export function monthCells(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`)
  const firstColumn = (date.getUTCDay() + 6) % 7
  const days: (string | null)[] = Array.from({ length: firstColumn }, () => null)
  while (date.toISOString().slice(0, 7) === month) {
    days.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  while (days.length % 7) days.push(null)
  return days
}
