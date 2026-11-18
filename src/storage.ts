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
export type GitHubSession = { token: string; actor: string }

export class StaleDataError extends Error {
  constructor() {
    super('The repository changed after you opened this draft. Download your draft if needed, then load the latest data and reapply your changes.')
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

async function github(url: string, token: string, options: RequestInit = {}) {
  if (!hasRepository) throw new Error('GitHub writing is available on a configured Pages deployment.')
  const response = await request(url, {
    ...options,
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (response.status === 409 && options.method === 'PUT') throw new StaleDataError()
  if (response.status === 401) throw new Error('GitHub rejected the token. Check whether it has expired or been revoked.')
  if (response.status === 403 || response.status === 404) {
    throw new Error('GitHub denied access. Check the selected repository, Contents permissions and branch rules.')
  }
  if (response.status === 422 && options.method === 'PUT') {
    throw new Error('GitHub rejected this commit. Check the branch rules, or download the JSON and open a pull request.')
  }
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Refresh repository data before retrying.`)
  return response.json()
}

function fromBase64(content: string) {
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(content), char => char.charCodeAt(0)))
}

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  }
  return btoa(chunks.join(''))
}

async function repositoryFile(token: string) {
  const file = await github(`${contents}?ref=${ref}`, token)
  if (file.type !== 'file' || !/^[a-f\d]{40}$/i.test(file.sha)) throw new Error('GitHub did not return the expected app.json file.')
  return file
}

export async function readRepository(token: string): Promise<Snapshot> {
  const file = await repositoryFile(token)
  const blob = file.encoding === 'base64' ? file : await github(`${api}/git/blobs/${file.sha}`, token)
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('GitHub could not return the JSON contents.')
  return { data: parseDirectory(JSON.parse(fromBase64(blob.content))), sha: file.sha }
}

export async function connectGitHub(token: string) {
  const [profile, repo] = await Promise.all([
    github('https://api.github.com/user', token), github(api, token),
  ])
  if (!repo.permissions?.push) throw new Error('This GitHub account needs write access to the deployment repository.')
  if (typeof profile.login !== 'string') throw new Error('GitHub did not return an account name.')
  const snapshot = await readRepository(token)
  return { session: { token, actor: profile.login }, snapshot }
}

export async function writeRepository(session: GitHubSession, expectedSha: string, data: Directory): Promise<Snapshot> {
  const latest = await repositoryFile(session.token)
  if (latest.sha !== expectedSha) throw new StaleDataError()
  try {
    const result = await github(contents, session.token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branch, sha: expectedSha, content: toBase64(serialize(data)),
        message: `Update Tally ledger (${data.revision})`,
      }),
    })
    const sha = result.content?.sha
    if (typeof sha !== 'string' || !/^[a-f\d]{40}$/i.test(sha)) throw new Error('GitHub did not return the saved file version.')
    return { data, sha }
  } catch (error) {
    // GitHub can accept a write even when its response is lost.
    const current = await readRepository(session.token).catch(() => null)
    if (current && current.data.revision === data.revision) return current
    if (current && current.sha !== expectedSha) throw new StaleDataError()
    throw error
  }
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
