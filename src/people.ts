import type { Member } from './model'

export function firstName(name: string) {
  return name.trim().split(/\s+/u, 1)[0]
}

function normalizeName(name: string) {
  return name.trim().normalize('NFC').replace(/\s+/gu, ' ').toLowerCase()
}

export function accountMemberId(members: Member[], profileName: string) {
  const profile = normalizeName(profileName)
  if (!profile) return ''
  const first = firstName(profile)
  const matchingFirst = members.filter(member => firstName(normalizeName(member.name)) === first)
  const exact = matchingFirst.filter(member => normalizeName(member.name) === profile)
  if (profile !== first && exact.length === 1) return exact[0].id
  if (matchingFirst.length === 1 && normalizeName(matchingFirst[0].name) === first) return matchingFirst[0].id
  return ''
}

export function memberLabels(members: Member[]) {
  const names = new Map<string, Member[]>()
  for (const member of members) {
    const first = normalizeName(firstName(member.name))
    const matching = names.get(first)
    if (matching) matching.push(member)
    else names.set(first, [member])
  }
  const labels = new Map<string, string>()
  for (const matching of names.values()) {
    matching.forEach((member, index) => labels.set(member.id, matching.length > 1
      ? `${firstName(member.name)} (${index + 1})` : firstName(member.name)))
  }
  return labels
}
