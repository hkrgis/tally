import { parseDirectory, type Directory } from './vault'

const repository: string = import.meta.env.VITE_GITHUB_REPOSITORY ?? ''
const branch: string = import.meta.env.VITE_GITHUB_BRANCH ?? 'main'
const path = 'public/app.json'
const api = `https://api.github.com/repos/${repository}`
const contents = `${api}/contents/${path}`
const ref = encodeURIComponent(branch)
export const hasRepository = /^[\w.-]+\/[\w.-]+$/.test(repository)
export const repositoryUrl = hasRepository ? `https://github.com/${repository}` : ''
export const editUrl = hasRepository ? `${repositoryUrl}/edit/${ref}/${path}` : ''
export const dataUrl = new URL(`${import.meta.env.BASE_URL}app.json`, document.baseURI)

export type Snapshot = { data: Directory; sha: string }

export class StaleDataError extends Error {
  constructor() {
    super('The repository changed while you were editing. Reload the workspace and reapply your changes to the latest version.')
  }
}

export function serialize(data: Directory) {
  return JSON.stringify(data, null, 2) + '\n'
}

async function request(url: URL | string, options: RequestInit) {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined
  try {
    return await fetch(url, { ...options, signal })
  } catch (error) {
    if (signal?.aborted) throw new Error('The request timed out. Try again when your connection is available.')
    throw error
  }
}

export async function readPublished(revision?: string): Promise<{ data: Directory; offline: boolean }> {
  const url = new URL(dataUrl)
  if (revision) url.searchParams.set('revision', `${revision}-${Math.floor(Date.now() / 15_000)}`)
  const response = await request(url, { cache: 'no-store' })
  if (!response.ok) throw new Error('Published data could not be loaded. Try refreshing.')
  return { data: parseDirectory(await response.json()), offline: response.headers.get('X-Tally-Offline') === '1' }
}

async function github(url: string) {
  if (!hasRepository) throw new Error('This build has no GitHub repository configured.')
  const response = await request(url, {
    cache: 'no-store',
    redirect: 'error',
    credentials: 'omit',
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`Could not check the repository (HTTP ${response.status}). Try again shortly.`)
  return response.json()
}

function fromBase64(content: string) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content), char => char.charCodeAt(0)))
}

export async function readRepository(): Promise<Snapshot> {
  const file = await github(`${contents}?ref=${ref}`)
  if (file.type !== 'file' || !/^[a-f\d]{40}$/i.test(file.sha)) throw new Error('GitHub did not return the expected app.json file.')
  const blob = file.encoding === 'base64' ? file : await github(`${api}/git/blobs/${file.sha}`)
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('GitHub could not return the JSON contents.')
  return { data: parseDirectory(JSON.parse(fromBase64(blob.content))), sha: file.sha }
}

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
