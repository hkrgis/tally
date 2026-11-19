export class StaleDataError extends Error {}

export function download(name: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toCsv(rows: (string | number)[][]) {
  return rows.map(row => row.map(cell => {
    const value = String(cell)
    const safe = typeof cell === 'string' && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(value) ? "'" + value : value
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n') + '\r\n'
}
