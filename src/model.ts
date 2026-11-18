import { z } from 'zod/mini'
import { en } from 'zod/locales'

z.config(en())

export const categories = ['Food & drink', 'Groceries', 'Transport', 'Home', 'Sports', 'Entertainment', 'Travel', 'Other'] as const
export const splitMethods = ['equal', 'percentage', 'exact', 'weighted'] as const
export const frequencies = ['Weekly', 'Fortnightly', 'Monthly'] as const
export const currencies = Intl.supportedValuesOf('currency')
const minorAmount = z.int().check(z.maximum(1_000_000_000_000))
const positive = minorAmount.check(z.minimum(1))
const id = z.string().check(z.regex(/^[a-zA-Z0-9][\w-]{0,79}$/))
const timestamp = z.iso.datetime()
const day = z.iso.date()
const title = z.string().check(z.trim(), z.minLength(1), z.maxLength(100))
const notes = z.string().check(z.maxLength(1000))
const entry = z.object({ memberId: id, amount: positive })
export const maxExpensePhotos = 3
export const maxPhotoBytes = 240_000
const photoSchema = z.object({
  id,
  name: title,
  source: z.string().check(z.maxLength(23 + 4 * Math.ceil(maxPhotoBytes / 3)),
    z.regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)),
})

const groupSchema = z.object({
  id, name: title, description: z.string().check(z.maxLength(240)),
  currency: z.string().check(z.refine(value => currencies.includes(value), 'Unsupported currency')),
  archived: z.boolean(),
})
const memberSchema = z.object({ id, groupId: id, name: title, active: z.boolean() })
const expenseSchema = z.object({
  id, groupId: id, description: title, amount: positive, date: day,
  category: z.enum(categories), notes, payers: z.array(entry).check(z.minLength(1)),
  photos: z.optional(z.array(photoSchema).check(z.maxLength(maxExpensePhotos))),
  split: z.object({
    method: z.enum(splitMethods),
    participants: z.array(z.object({ memberId: id, amount: minorAmount.check(z.minimum(0)) })).check(z.minLength(1)),
  }),
  sessionId: z.optional(id),
})
const paymentSchema = z.object({
  id, groupId: id, from: id, to: id, amount: positive, date: day, notes,
})
const sessionSchema = z.object({
  id, groupId: id, name: title, amount: positive, startDate: day, frequency: z.enum(frequencies),
  payerId: id, attendeeIds: z.array(id).check(z.minLength(1)), active: z.boolean(),
})
const activitySchema = z.object({
  id, groupId: id, entityId: id, entity: z.enum(['group', 'member', 'expense', 'payment', 'session']),
  action: z.enum(['created', 'updated', 'archived', 'restored', 'removed']),
  title, actor: title, at: timestamp,
})
const documentSchema = z.object({
  version: z.literal(1),
  groups: z.array(groupSchema), members: z.array(memberSchema), expenses: z.array(expenseSchema),
  payments: z.array(paymentSchema), sessions: z.array(sessionSchema), activity: z.array(activitySchema),
  revision: z.optional(id),
})

export type AppData = z.infer<typeof documentSchema>
export type Group = z.infer<typeof groupSchema>
export type Member = z.infer<typeof memberSchema>
export type Expense = z.infer<typeof expenseSchema>
export type ExpensePhoto = z.infer<typeof photoSchema>
export type Payment = z.infer<typeof paymentSchema>
export type SportsSession = z.infer<typeof sessionSchema>
export type Activity = z.infer<typeof activitySchema>
export type SplitMethod = Expense['split']['method']

function unique(values: string[]) {
  return new Set(values).size === values.length
}

export function parseData(input: unknown): AppData {
  const result = documentSchema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`${issue.path.join('.') || 'app.json'}: ${issue.message}`)
  }
  const data = result.data
  const groups = new Set(data.groups.map(group => group.id))
  const members = new Map(data.members.map(member => [member.id, member.groupId]))
  const sessions = new Map(data.sessions.map(session => [session.id, session.groupId]))
  const occurrences = data.expenses.flatMap(expense => expense.sessionId ? [`${expense.sessionId}:${expense.date}`] : [])
  const tables = [data.groups, data.members, data.expenses, data.payments, data.sessions, data.activity]
  if (tables.some(records => !unique(records.map(record => record.id)))) throw new Error('Record IDs must be unique within each table.')
  if (!unique(occurrences)) throw new Error('A sports session can only be recorded once per date.')
  for (const records of tables.slice(1)) {
    if (records.some(record => 'groupId' in record && !groups.has(record.groupId))) throw new Error('A record refers to an unknown group.')
  }
  const inGroup = (groupId: string, ids: string[]) => ids.every(memberId => members.get(memberId) === groupId)
  for (const expense of data.expenses) {
    if (expense.photos && !unique(expense.photos.map(photo => photo.id))) throw new Error('Expense photo IDs must be unique.')
    const payerIds = expense.payers.map(payer => payer.memberId)
    const participantIds = expense.split.participants.map(participant => participant.memberId)
    const { method, participants } = expense.split
    const splitTotal = participants.reduce((sum, participant) => sum + participant.amount, 0)
    if (!inGroup(expense.groupId, [...payerIds, ...participantIds]) || !unique(payerIds) || !unique(participantIds)) {
      throw new Error(`${expense.description}: choose distinct payers and participants from the group.`)
    }
    if (expense.payers.reduce((sum, payer) => sum + payer.amount, 0) !== expense.amount) {
      throw new Error(`${expense.description}: payer amounts must add up to the expense total.`)
    }
    if ((method === 'exact' && splitTotal !== expense.amount) ||
        (method === 'percentage' && splitTotal !== 10_000) ||
        (method === 'equal' && participants.some(participant => participant.amount !== 1)) ||
        (method === 'weighted' && participants.some(participant => participant.amount < 1))) {
      throw new Error(`${expense.description}: check the split values and total.`)
    }
    if (expense.sessionId && sessions.get(expense.sessionId) !== expense.groupId) throw new Error('An expense refers to an unknown sports session.')
  }
  for (const payment of data.payments) {
    if (payment.from === payment.to || !inGroup(payment.groupId, [payment.from, payment.to])) {
      throw new Error('Payments must be between two distinct members of the group.')
    }
  }
  for (const session of data.sessions) {
    if (!unique(session.attendeeIds) || !inGroup(session.groupId, [session.payerId, ...session.attendeeIds])) {
      throw new Error(`${session.name}: choose a payer and distinct attendees from the group.`)
    }
  }
  for (const records of [data.expenses, data.payments]) {
    const totals = new Map<string, number>()
    for (const record of records) {
      const total = (totals.get(record.groupId) ?? 0) + record.amount
      if (!Number.isSafeInteger(total)) throw new Error('A group’s accumulated total exceeds the supported range.')
      totals.set(record.groupId, total)
    }
  }
  return data
}

export function nextSessionDate(session: SportsSession, expenses: Expense[]) {
  const latest = expenses.filter(expense => expense.sessionId === session.id && expense.date >= session.startDate)
    .map(expense => expense.date).sort().at(-1)
  if (!latest) return session.startDate
  const date = new Date(`${latest}T00:00:00Z`)
  if (session.frequency === 'Monthly') {
    const dayOfMonth = Number(session.startDate.slice(8))
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + 1)
    const endOfMonth = new Date(date)
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1, 0)
    date.setUTCDate(Math.min(dayOfMonth, endOfMonth.getUTCDate()))
  } else {
    date.setUTCDate(date.getUTCDate() + (session.frequency === 'Weekly' ? 7 : 14))
  }
  return date.getUTCFullYear() > 9999 ? null : date.toISOString().slice(0, 10)
}

export function today() {
  const date = new Date()
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
