import type { AppData } from './model'

export const guestDays = 7
export const tokenPattern = /^[a-f0-9]{64}$/
export const maxGuestParts = 17
const partSize = 500_000
export const maxParts = 12
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
export const newToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)))
export const emailKey = async (email: string) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(email.trim().toLowerCase()))))

export function snapshotParts(value: unknown, limit = maxParts) {
  const bytes = encoder.encode(JSON.stringify(value))
  if (bytes.length > partSize * limit) throw new Error('This group is too large to save. Remove some photos and try again.')
  const parts: string[] = []
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + partSize, bytes.length)
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    parts.push(decoder.decode(bytes.subarray(start, end)))
    start = end
  }
  if (parts.length > limit) throw new Error('This group is too large to save. Remove some photos and try again.')
  return parts
}

const fromBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
function toBase64(value: Uint8Array) {
  let binary = ''
  for (let start = 0; start < value.length; start += 8192) binary += String.fromCharCode(...value.subarray(start, start + 8192))
  return btoa(binary)
}

function guestKey(token: string) {
  if (!tokenPattern.test(token)) throw new Error('Enter a valid guest code or link.')
  const bytes = Uint8Array.from(token.match(/../g)!, byte => Number.parseInt(byte, 16))
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function guestParts(data: AppData, token: string, revision: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const { id, name, description, currency, paymentMethods } = data.groups[0]
  const view = { ...data, groups: [{ id, name, description, currency, paymentMethods, archived: false }] }
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(revision) },
    await guestKey(token), encoder.encode(JSON.stringify(view)))
  return snapshotParts({ iv: toBase64(iv), payload: toBase64(new Uint8Array(cipher)) }, maxGuestParts)
}

export async function decodeGuest(parts: string[], token: string, revision: string): Promise<unknown> {
  const { iv, payload } = JSON.parse(parts.join(''))
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(revision) },
    await guestKey(token), fromBase64(payload))
  return JSON.parse(decoder.decode(bytes))
}
