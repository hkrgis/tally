import { z } from 'zod/mini'
import { parseData, type AppData, type Group } from './model'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const iterations = 600_000
export const minPasswordLength = 14
export const maxPasswordLength = 128
const id = z.string().check(z.regex(/^[a-zA-Z0-9][\w-]{0,79}$/))
const base64 = /^[A-Za-z0-9+/]+={0,2}$/
const groupEntry = z.strictObject({
  id,
  name: z.string().check(z.minLength(1), z.maxLength(100)),
  archived: z.boolean(),
  salt: z.string().check(z.length(24), z.regex(base64)),
  iv: z.string().check(z.length(16), z.regex(base64)),
  ciphertext: z.string().check(z.minLength(24), z.regex(base64)),
})
const directorySchema = z.strictObject({
  version: z.literal(2),
  groups: z.array(groupEntry),
  revision: z.optional(id),
})

export type GroupEntry = z.infer<typeof groupEntry>
export type Directory = z.infer<typeof directorySchema>
type GroupKey = { key: CryptoKey; salt: string }

export function parseDirectory(input: unknown): Directory {
  const result = directorySchema.safeParse(input)
  if (!result.success) throw new Error('The published group directory could not be read.')
  const directory = result.data
  if (new Set(directory.groups.map(group => group.id)).size !== directory.groups.length ||
      directory.groups.some(group => fromBase64(group.salt).length !== 16 ||
        fromBase64(group.iv).length !== 12 || group.ciphertext.length % 4 !== 0)) {
    throw new Error('The group directory contains invalid or duplicate entries.')
  }
  return directory
}

function toBase64(bytes: Uint8Array) {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  return btoa(chunks.join(''))
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

function webCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error('Group passwords require HTTPS or localhost in a supported browser.')
  return globalThis.crypto
}

function deriveKey(password: string, salt: string) {
  const { subtle } = webCrypto()
  return subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']).then(material =>
    subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt: fromBase64(salt) }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']))
}

export async function createGroupKey(password: string): Promise<GroupKey> {
  if (password.trim().length < minPasswordLength || password.length > maxPasswordLength) {
    throw new Error(`Choose a group password with ${minPasswordLength} to ${maxPasswordLength} characters.`)
  }
  const salt = toBase64(webCrypto().getRandomValues(new Uint8Array(16)))
  return { salt, key: await deriveKey(password, salt) }
}

function header(group: Pick<Group, 'id' | 'name' | 'archived'>) {
  return { id: group.id, name: group.name, archived: group.archived }
}

function additionalData(group: Pick<GroupEntry, 'id' | 'name' | 'archived' | 'salt'>) {
  return encoder.encode(JSON.stringify([2, group.id, group.name, group.archived, group.salt]))
}

function checkGroup(data: AppData, entry: Pick<GroupEntry, 'id' | 'name' | 'archived'>) {
  const group = data.groups[0]
  if (data.groups.length !== 1 || group.id !== entry.id || group.name !== entry.name || group.archived !== entry.archived) {
    throw new Error('The encrypted records do not match this group.')
  }
}

export async function sealGroup(data: AppData, { key, salt }: GroupKey): Promise<GroupEntry> {
  if (data.groups.length !== 1) throw new Error('Select a single group to save.')
  const entry = { ...header(data.groups[0]), salt }
  const iv = webCrypto().getRandomValues(new Uint8Array(12))
  const encrypted = await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(entry) }, key,
    encoder.encode(JSON.stringify(data)))
  return { ...entry, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) }
}

export async function openGroup(entry: GroupEntry, password: string) {
  if (!password || password.length > maxPasswordLength) throw new Error('Enter the group password.')
  const key = await deriveKey(password, entry.salt)
  let bytes: ArrayBuffer
  try {
    bytes = await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(entry.iv), additionalData: additionalData(entry) },
      key, fromBase64(entry.ciphertext))
  } catch {
    throw new Error('Could not unlock this group. Check the password and try again.')
  }
  const data = parseData(JSON.parse(decoder.decode(bytes)))
  checkGroup(data, entry)
  return { data, key, salt: entry.salt, entry }
}

export function sameEntry(left: GroupEntry | undefined, right: GroupEntry) {
  return left?.id === right.id && left.name === right.name && left.archived === right.archived &&
    left.salt === right.salt && left.iv === right.iv && left.ciphertext === right.ciphertext
}
